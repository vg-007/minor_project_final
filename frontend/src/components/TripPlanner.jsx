import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

// ── Haversine distance (km) between two lat/lng points ───────────────────────
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ── Greedy nearest-neighbour route optimizer ─────────────────────────────────
// Sorts places by nearest-next from current position. Falls back to
// openingTime sort when coordinates are unavailable.
const optimizePlaces = (places, days) => {
  const withCoords = places.filter(p => p.latitude && p.longitude);
  const withoutCoords = places.filter(p => !p.latitude || !p.longitude);

  let sorted = [];
  if (withCoords.length > 0) {
    const remaining = [...withCoords];
    let current = remaining.shift();
    sorted.push(current);
    while (remaining.length > 0) {
      let nearest = null;
      let minDist = Infinity;
      let nearestIdx = 0;
      remaining.forEach((p, i) => {
        const d = haversine(current.latitude, current.longitude, p.latitude, p.longitude);
        if (d < minDist) { minDist = d; nearest = p; nearestIdx = i; }
      });
      remaining.splice(nearestIdx, 1);
      sorted.push(nearest);
      current = nearest;
    }
    sorted = [...sorted, ...withoutCoords];
  } else {
    // No coords — sort by opening time
    sorted = [...places].sort((a, b) => {
      const ta = a.openingTime ? parseInt(a.openingTime.replace(':', ''), 10) : 999;
      const tb = b.openingTime ? parseInt(b.openingTime.replace(':', ''), 10) : 999;
      return ta - tb;
    });
  }

  // Distribute into days
  const perDay = Math.ceil(sorted.length / Math.max(days, 1));
  const itinerary = [];
  for (let d = 0; d < days; d++) {
    const dayPlaces = sorted.slice(d * perDay, (d + 1) * perDay);
    if (dayPlaces.length > 0) itinerary.push({ day: d + 1, places: dayPlaces });
  }
  return itinerary;
};

// ── Wikipedia Filter Helper ──────────────────────────────────────────────────
const filterWikipediaResults = (results, stateQuery) => {
  const BAD_TITLES = ["tourism", "history", "culture", "movie", "film", "song", "list of", "overview", "district", "state", "india"];
  const GOOD_WORDS = ["temple", "fort", "palace", "museum", "park", "lake", "hill", "garden", "beach", "monument", "zoo", "sanctuary", "waterfall", "island", "church", "mosque"];

  let filtered = results.filter(item => {
    const titleLower = item.title.toLowerCase();
    const snippetLower = item.snippet.toLowerCase();

    // 1. STRICT TITLE FILTER
    if (BAD_TITLES.some(bad => titleLower.includes(bad))) return false;

    // 4. REMOVE GENERIC RESULTS
    if (!item.snippet || item.snippet.length < 20) return false;

    // 3. STATE FILTER (STRICT)
    if (stateQuery) {
      const stateLower = stateQuery.toLowerCase();
      if (!titleLower.includes(stateLower) && !snippetLower.includes(stateLower)) return false;
    }

    // 2. KEYWORD VALIDATION
    return GOOD_WORDS.some(good => titleLower.includes(good) || snippetLower.includes(good));
  });

  // 7. FALLBACK
  if (filtered.length < 3) {
    filtered = results.filter(item => {
      const titleLower = item.title.toLowerCase();
      if (BAD_TITLES.some(bad => titleLower.includes(bad))) return false;
      if (!item.snippet || item.snippet.length < 20) return false;
      return true; // Relax keyword and state filters
    });
  }

  // 6. LIMIT CLEAN DATA
  return filtered.slice(0, 10);
};

// ─────────────────────────────────────────────────────────────────────────────
const CITIES = ['Hyderabad', 'Bangalore', 'Chennai', 'Mumbai', 'Delhi', 'Kolkata', 'Jaipur', 'Agra', 'Goa', 'Varanasi'];

// ── Overpass API Helper ──────────────────────────────────────────────────
const OSM_NAME_BLACKLIST = ["tourism", "list", "movie", "film", "song", "history", "overview", "culture", "district", "state", "india"];

const isValidOsmName = (name) => {
  if (!name || name.trim().length < 3) return false;
  const lower = name.toLowerCase();
  if (OSM_NAME_BLACKLIST.some(bad => lower.includes(bad))) return false;
  return true;
};

const fetchOverpassPlaces = async (lat, lon, radius = 80000) => {
  const getQuery = (rad) => `[out:json][timeout:30];
(
  node["tourism"="attraction"](around:${rad},${lat},${lon});
  way["tourism"="attraction"](around:${rad},${lat},${lon});
  node["tourism"="museum"](around:${rad},${lat},${lon});
  way["tourism"="museum"](around:${rad},${lat},${lon});
  node["tourism"="zoo"](around:${rad},${lat},${lon});
  way["tourism"="zoo"](around:${rad},${lat},${lon});
  node["tourism"="gallery"](around:${rad},${lat},${lon});
  way["tourism"="gallery"](around:${rad},${lat},${lon});
  node["leisure"="park"](around:${rad},${lat},${lon});
  way["leisure"="park"](around:${rad},${lat},${lon});
  node["natural"](around:${rad},${lat},${lon});
  way["natural"](around:${rad},${lat},${lon});
  node["historic"](around:${rad},${lat},${lon});
  way["historic"](around:${rad},${lat},${lon});
  node["amenity"="place_of_worship"](around:${rad},${lat},${lon});
  way["amenity"="place_of_worship"](around:${rad},${lat},${lon});
);
out center 60;`;

  let res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: getQuery(radius),
    headers: { 'Content-Type': 'text/plain' }
  });
  let data = await res.json();
  console.log('Overpass response:', data);

  // If empty, retry with 120km
  if (!data.elements || data.elements.length === 0) {
    console.log('Overpass empty, retrying with 120000 radius...');
    res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: getQuery(120000),
      headers: { 'Content-Type': 'text/plain' }
    });
    data = await res.json();
    console.log('Overpass response (retry):', data);
  }

  const seen = new Set();
  const results = [];

  // Sort so tourism-tagged nodes come first
  const elements = (data.elements || []).sort((a, b) => {
    const aHasTourism = a.tags?.tourism ? 0 : 1;
    const bHasTourism = b.tags?.tourism ? 0 : 1;
    return aHasTourism - bHasTourism;
  });

  for (const el of elements) {
    if (!el.tags) continue;
    const name = (el.tags.name || '').trim();
    if (!isValidOsmName(name)) continue;           // minimal filtering for missing/invalid names
    if (seen.has(name.toLowerCase())) continue;    // deduplicate
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (!elLat || !elLon) continue;               // must have valid coords

    seen.add(name.toLowerCase());
    results.push({
      id: `osm_${el.id}`,
      name,
      latitude: elLat,
      longitude: elLon,
      type: el.tags.tourism || el.tags.leisure || el.tags.historic || el.tags.natural || el.tags.amenity || 'Attraction',
      description: el.tags.description || null,
      image: null,
      openingTime: el.tags.opening_hours || 'N/A',
      closingTime: 'N/A',
      rating: 5
    });
    if (results.length >= 60) break;
  }

  console.log('Total places fetched:', results.length);
  return results;
};

// ── Overpass Nearby Services Helper ──────────────────────────────────────────
const fetchNearbyServices = async (lat, lon) => {
  const overpassQuery = `[out:json][timeout:20];
(
  node["amenity"="restaurant"](around:5000,${lat},${lon});
  node["amenity"="hospital"](around:5000,${lat},${lon});
  node["tourism"="hotel"](around:5000,${lat},${lon});
  node["tourism"="guest_house"](around:5000,${lat},${lon});
  node["amenity"="atm"](around:5000,${lat},${lon});
  node["amenity"="police"](around:5000,${lat},${lon});
);
out center;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: { 'Content-Type': 'text/plain' }
    });
    const data = await res.json();
    const results = [];
    
    for (const el of (data.elements || [])) {
      if (!el.lat && !el.center) continue;
      let name = (el.tags && el.tags.name) ? el.tags.name.trim() : "Unnamed";
      // Optional: ignore unnamed if it's not ATM or Police (since those are often unnamed)
      if (name === "Unnamed" && !['atm','police'].includes(el.tags.amenity)) continue;
      
      const type = el.tags.amenity || el.tags.tourism || 'unknown';
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      const dist = haversine(lat, lon, elLat, elLon).toFixed(1);
      
      results.push({ name, type, latitude: elLat, longitude: elLon, distance: dist });
    }

    // Sort by distance and return top 20
    results.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
    const final = results.slice(0, 20);
    console.log("Nearby services:", final);
    return final;
  } catch (err) {
    console.warn("fetchNearbyServices error", err);
    return [];
  }
};

// ── Wikipedia Enrichment Helper ───────────────────────────────────────────────
// Wikipedia is used ONLY for descriptions + images. NEVER as a place source.
const enrichWithWikipedia = async (places) => {
  const enriched = await Promise.all(places.map(async (place) => {
    try {
      // Exact title lookup
      const exactRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages|extracts&titles=${encodeURIComponent(place.name)}&format=json&origin=*&exintro=true&explaintext=true&piprop=original`
      );
      const exactData = await exactRes.json();
      if (exactData.query && exactData.query.pages) {
        const pageId = Object.keys(exactData.query.pages)[0];
        if (pageId !== '-1') {
          const page = exactData.query.pages[pageId];
          if (page.extract || page.original) {
            return {
              ...place,
              description: page.extract ? page.extract.substring(0, 300) + '...' : (place.description || 'No description available.'),
              image: page.original ? page.original.source : null
            };
          }
        }
      }
      // Search fallback – only use result if its title closely matches the place name
      const searchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(place.name)}&srlimit=1&format=json&origin=*`
      );
      const searchData = await searchRes.json();
      if (searchData.query && searchData.query.search && searchData.query.search.length > 0) {
        const topResult = searchData.query.search[0];
        // GUARD: reject if the best search result title doesn't relate to the place name
        const titleLower = topResult.title.toLowerCase();
        const nameLower = place.name.toLowerCase();
        const isRelevant = titleLower.includes(nameLower) || nameLower.includes(titleLower.split(' ')[0]);
        if (!isRelevant) return place; // skip unrelated Wikipedia results

        const detailRes = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages|extracts&titles=${encodeURIComponent(topResult.title)}&format=json&origin=*&exintro=true&explaintext=true&piprop=original`
        );
        const detailData = await detailRes.json();
        if (detailData.query && detailData.query.pages) {
          const pid = Object.keys(detailData.query.pages)[0];
          if (pid !== '-1') {
            const page = detailData.query.pages[pid];
            return {
              ...place,
              description: page.extract ? page.extract.substring(0, 300) + '...' : (place.description || 'No description available.'),
              image: page.original ? page.original.source : null
            };
          }
        }
      }
    } catch (e) { /* Wikipedia failed — keep place as-is */ }
    return place;
  }));
  return enriched;
};

// ── Final Place Cleaner ─────────────────────────────────────────────────────
// Applied to the final list regardless of which source produced it.
const PLACE_BAD_WORDS  = ['tourism','history','culture','movie','film','song','list of','overview','district','state','india'];
const PLACE_GOOD_WORDS = ['temple','fort','palace','museum','park','lake','hill','garden','beach','monument','zoo','sanctuary','waterfall','island','church','mosque','masjid','mandir','dargah','reservoir','cave','wildlife'];

const cleanPlaces = (places, state = '') => {
  // Only block genuinely invalid entries — no keyword dependency
  let cleaned = places.filter(p => {
    if (!p.name || p.name.trim().length < 3) return false;
    const nameLower = p.name.toLowerCase();
    if (PLACE_BAD_WORDS.some(b => nameLower.includes(b))) return false;
    return true; // keep all valid named places with coords
  });

  const final = cleaned.slice(0, 40);
  console.log('Final filtered places:', final);
  return final;
};

const TripPlanner = () => {
  // ── Input state ──────────────────────────────────────────────────────────
  const [city, setCity]         = useState('');
  const [customCity, setCustomCity] = useState('');
  const [useLocation, setUseLocation] = useState(false);
  const [locStatus, setLocStatus] = useState('');
  const [days, setDays]         = useState(1);

  // ── Place data ───────────────────────────────────────────────────────────
  const [places, setPlaces]             = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesError, setPlacesError]   = useState('');  // real errors only
  const [placesLabel, setPlacesLabel]   = useState('');  // success heading

  // ── Modal State ──────────────────────────────────────────────────────────
  const [detailsModal, setDetailsModal] = useState(null);
  const [detailsData, setDetailsData] = useState(null);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [nearbyServices, setNearbyServices] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedPlaces, setSelectedPlaces] = useState([]);

  // ── Generated itinerary ──────────────────────────────────────────────────
  const [itinerary, setItinerary]       = useState(null); // array of { day, places }

  // ── Saved trips ──────────────────────────────────────────────────────────
  const [savedTrips, setSavedTrips]     = useState([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState(null);

  // ── Active tab ───────────────────────────────────────────────────────────
  const [tab, setTab] = useState('plan'); // 'plan' | 'saved'

  // ── Fetch saved trips ─────────────────────────────────────────────────────
  const fetchSavedTrips = useCallback(async (uid) => {
    setLoadingTrips(true);
    try {
      const q = query(collection(db, 'trips'), where('userId', '==', uid));
      const snap = await getDocs(q);
      const trips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      trips.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setSavedTrips(trips);
    } catch (err) {
      console.error('fetchSavedTrips error:', err);
    } finally {
      setLoadingTrips(false);
    }
  }, []);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) fetchSavedTrips(user.uid);
    });
    return () => unsub();
  }, [fetchSavedTrips]);

  // ── "Use Current Location" → reverse-geocode city ────────────────────────
  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      setLocStatus('Geolocation not supported.');
      return;
    }
    setLocStatus('📡 Detecting location...');
    setUseLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
          const data = await res.json();
          const detectedCity =
            data.address?.city ||
            data.address?.town ||
            data.address?.county ||
            data.address?.state_district ||
            '';
          if (detectedCity) {
            setCity(detectedCity);
            setCustomCity(detectedCity);
            setLocStatus(`📍 Detected: ${detectedCity}`);
          } else {
            setLocStatus('Could not determine city. Please type it manually.');
          }
        } catch {
          setLocStatus('Reverse geocode failed. Enter city manually.');
        }
      },
      (err) => {
        setLocStatus('Location access denied. Please type your city.');
        setUseLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    let isMounted = true;
    const fetchPlaces = async () => {
      setSelectedPlaces([]);
      setItinerary(null);
      setPlacesError('');
      setPlacesLabel('');
      if (!city) { setPlaces([]); return; }
      setLoadingPlaces(true);

      try {
        const cityKey = city.trim().toLowerCase();

        // 1. Check Firestore Cache
        const q = query(collection(db, 'placesCache'), where('city', '==', cityKey));
        const snap = await getDocs(q);

        if (!isMounted) return;

        if (!snap.empty) {
          const cachedDoc = snap.docs[0].data();
          const cachedPlaces = cachedDoc.places || [];
          const cacheAge = Date.now() - (cachedDoc.fetchedAt || 0);
          const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
          // Skip stale or empty cache — re-fetch fresh data
          if (cachedPlaces.length > 0 && cacheAge < CACHE_TTL_MS) {
            setPlaces(cachedPlaces);
            setPlacesLabel(`Tourist Places in ${city} (cached)`);
            setLoadingPlaces(false);
            return;
          }
          // Cache is stale or empty — fall through to fresh fetch
          console.log('Cache stale or empty, re-fetching...');
        }

        console.log('City:', city);

        // 2. Geocode City using Nominatim
        const cityTrimmed = city.trim();
        let geoData;
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityTrimmed)}&format=json&limit=1`,
            { headers: { 'User-Agent': 'TravelEaseApp' } }
          );
          geoData = await geoRes.json();
          console.log('Nominatim response:', geoData);
        } catch (err) {
          console.error('Geocoding error:', err);
          throw new Error('Geocoding error');
        }

        if (!isMounted) return;

        if (!geoData || geoData.length === 0) {
          setPlacesError('Invalid city name. Please check the spelling.');
          setPlaces([]);
          setLoadingPlaces(false);
          return;
        }

        const lat = parseFloat(geoData[0].lat);
        const lon = parseFloat(geoData[0].lon);
        if (isNaN(lat) || isNaN(lon)) {
          setPlacesError('Could not resolve coordinates for this city.');
          setPlaces([]);
          setLoadingPlaces(false);
          return;
        }
        console.log('Coordinates:', lat, lon);

        // 3. Fetch Places via Overpass + Wikipedia Hybrid
        let list = [];
        try {
          let overpassPlaces = [];
          try {
            overpassPlaces = await fetchOverpassPlaces(lat, lon, 80000);
            console.log('Overpass places found:', overpassPlaces.length);
          } catch (overpassErr) {
            console.warn('Overpass failed, falling back to Wikipedia:', overpassErr);
          }

          if (overpassPlaces.length > 0) {
            // Overpass returned real places – enrich top 30 with Wikipedia descriptions/images
            list = await enrichWithWikipedia(overpassPlaces.slice(0, 30));
            if (isMounted) setPlacesLabel(`Showing top tourist places near ${city}`);
          } else {
            // ── Wikipedia Category Fallback ──────────────────────────────────
            // Category members are real place NAMES (e.g. "Charminar"), not search results.
            // We only keep members that Wikipedia can return with real geo-coordinates.
            console.log('Overpass empty — trying Wikipedia Category fallback...');
            const BAD_TITLE = ['list of','tourism','history','overview','culture','district','state','india','film','movie','song'];
            const uniqueTitles = new Set();

            const fetchCategory = async (cat) => {
              try {
                const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=50&format=json&origin=*`);
                const d = await r.json();
                (d.query?.categorymembers || []).forEach(m => {
                  const tl = m.title.toLowerCase();
                  if (!BAD_TITLE.some(b => tl.includes(b))) uniqueTitles.add(m.title);
                });
              } catch (e) { console.warn('Category fetch failed:', cat); }
            };

            await Promise.all([
              fetchCategory(`Category:Tourist attractions in ${city}`),
              fetchCategory(`Category:Buildings and structures in ${city}`),
              fetchCategory(`Category:Parks in ${city}`),
              fetchCategory(`Category:Museums in ${city}`)
            ]);

            const titleArr = Array.from(uniqueTitles);
            console.log('Category titles found:', titleArr.length);

            if (titleArr.length > 0) {
              // Bulk-fetch details+coordinates for top 20 titles in one API call
              const topTitles = titleArr.slice(0, 20);
              const detailUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages|coordinates&titles=${encodeURIComponent(topTitles.join('|'))}&format=json&origin=*&exintro=true&explaintext=true&piprop=original`;
              const detailRes = await fetch(detailUrl);
              const detailData = await detailRes.json();

              if (detailData.query?.pages) {
                for (const key of Object.keys(detailData.query.pages)) {
                  const page = detailData.query.pages[key];
                  // CRITICAL: reject any page without real Wikipedia coordinates
                  if (!page.coordinates || !page.coordinates[0]) continue;
                  if (page.pageid < 1) continue;

                  const titleLower = (page.title || '').toLowerCase();
                  if (BAD_TITLE.some(b => titleLower.includes(b))) continue; // double-check

                  list.push({
                    id: `wiki_${page.pageid}`,
                    name: page.title,
                    description: page.extract ? page.extract.substring(0, 300) + '...' : 'No description available.',
                    latitude: parseFloat(page.coordinates[0].lat),
                    longitude: parseFloat(page.coordinates[0].lon),
                    type: 'Attraction',
                    image: page.original ? page.original.source : null,
                    rating: 5,
                    openingTime: 'N/A',
                    closingTime: 'N/A'
                  });
                }
              }
              console.log('Valid Wikipedia category places (with coords):', list.length);
              if (list.length > 0 && isMounted) setPlacesLabel(`Top Tourist Attractions in ${city}`);
            }

            if (list.length === 0) {
              if (isMounted) setPlacesError('No tourist places found for this city. Try a nearby major city.');
              setPlaces([]);
              setLoadingPlaces(false);
              return;
            }
          }

          if (list.length === 0) {
            if (isMounted) setPlacesError('No tourist places found for this city.');
            setPlaces([]);
            setLoadingPlaces(false);
            return;
          }
        } catch (wikiErr) {
          console.error('Places fetch error:', wikiErr);
          throw new Error('Places fetch error');
        }

        if (!isMounted) return;

        // Clean final list — pass city as state context for relevance filter
        list = cleanPlaces(list, city);
        if (list.length === 0) {
          if (isMounted) setPlacesError('No valid tourist places found for this city.');
          setPlaces([]);
          setLoadingPlaces(false);
          return;
        }

        // 4. Store in Firestore Cache
        try {
          const cacheRef = doc(collection(db, 'placesCache'));
          await setDoc(cacheRef, { city: cityKey, places: list, fetchedAt: Date.now() });
        } catch (cacheErr) {
          console.warn('Cache write failed (non-fatal):', cacheErr);
        }

        if (isMounted) setPlaces(list);

      } catch (err) {
        if (err.message !== 'Geocoding error' && err.message !== 'Places fetch error') {
          console.error('Places fetch error:', err);
        }
        if (isMounted) setPlacesError('Unable to fetch places. Please try again.');
      } finally {
        if (isMounted) setLoadingPlaces(false);
      }
    };
    fetchPlaces();
    return () => { isMounted = false; };
  }, [city]);

  // ── Toggle place selection ────────────────────────────────────────────────
  const togglePlace = (place) => {
    setItinerary(null); // reset generated plan when selection changes
    setSelectedPlaces(prev => {
      const exists = prev.findIndex(p => p.id === place.id);
      return exists >= 0 ? prev.filter(p => p.id !== place.id) : [...prev, place];
    });
  };

  // ── Generate optimized itinerary ─────────────────────────────────────────
  const handleGenerate = () => {
    if (selectedPlaces.length === 0) return;
    const result = optimizePlaces(selectedPlaces, Number(days));
    setItinerary(result);
  };

  // ── Save trip to Firestore ────────────────────────────────────────────────
  const handleSaveTrip = async () => {
    const user = auth.currentUser;
    if (!user) { setSaveMsg({ type: 'error', text: 'You must be logged in to save.' }); return; }
    if (!itinerary && selectedPlaces.length === 0) {
      setSaveMsg({ type: 'error', text: 'Generate or select places first.' });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      // Flatten itinerary back to ordered places array for storage
      const orderedPlaces = itinerary
        ? itinerary.flatMap(d => d.places)
        : selectedPlaces;

      const tripData = {
        userId: user.uid,
        city: city || customCity || 'Unknown',
        days: Number(days),
        places: orderedPlaces.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description || '',
          openingTime: p.openingTime || '',
          closingTime: p.closingTime || '',
          latitude: p.latitude || null,
          longitude: p.longitude || null,
        })),
        itinerary: itinerary || null,
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'trips'), tripData);
      setSaveMsg({ type: 'success', text: `Trip to ${tripData.city} saved! (${orderedPlaces.length} stops over ${days} day${days > 1 ? 's' : ''})` });
      setSelectedPlaces([]);
      setItinerary(null);
      fetchSavedTrips(user.uid);
      setTab('saved');
      setTimeout(() => setSaveMsg(null), 5000);
    } catch (err) {
      console.error('saveTrip error:', err);
      setSaveMsg({ type: 'error', text: 'Failed to save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete a saved trip ───────────────────────────────────────────────────
  const handleDeleteTrip = async (tripId) => {
    try {
      await deleteDoc(doc(db, 'trips', tripId));
      setSavedTrips(prev => prev.filter(t => t.id !== tripId));
    } catch (err) {
      console.error('deleteTrip error:', err);
    }
  };

  const activeCity = customCity || city;
  const canGenerate = selectedPlaces.length > 0;
  const canSave = itinerary ? true : selectedPlaces.length > 0;

  // ── Open Place Details ───────────────────────────────────────────────────
  const handleOpenDetails = async (place) => {
    console.log("Selected:", place.name);
    setDetailsLoading(true);

    let placeLat = place.latitude;
    let placeLon = place.longitude;

    try {
      if (!placeLat || !placeLon) {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place.name)}&format=json&limit=1`, {
          headers: { "User-Agent": "TravelEaseApp" }
        });
        const geoData = await geoRes.json();
        if (geoData && geoData.length > 0) {
          placeLat = parseFloat(geoData[0].lat);
          placeLon = parseFloat(geoData[0].lon);
        }
      }
    } catch (e) {
      console.error("Geocoding failed for place", e);
    }

    const currentPlace = { ...place, latitude: placeLat, longitude: placeLon, id: place.id || `wiki_${place.name}` };
    setDetailsModal(currentPlace);
    setDetailsData(null);
    setNearbyPlaces([]);
    setNearbyServices([]);

    // ── Wikipedia: 2-step lookup (exact title → search fallback) ──────────
    let fetchedDetails = { ...currentPlace, description: 'Details not available', image: null };

    try {
      try {
      const exactRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages|extracts&titles=${encodeURIComponent(place.name)}&format=json&origin=*&exintro=true&explaintext=true&piprop=original`
      );
      const exactJson = await exactRes.json();
      if (exactJson.query && exactJson.query.pages) {
        const pageId = Object.keys(exactJson.query.pages)[0];
        if (pageId !== '-1') {
          const page = exactJson.query.pages[pageId];
          if (page.extract || page.original) {
            fetchedDetails.name = page.title || place.name;
            fetchedDetails.description = page.extract || 'Details not available';
            fetchedDetails.image = page.original ? page.original.source : null;
          } else {
            // Page found but no content — try search fallback
            throw new Error('empty_page');
          }
        } else {
          throw new Error('not_found');
        }
      }
    } catch (wikiExact) {
      // Fallback: search Wikipedia by name
      try {
        const searchRes = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(place.name)}&srlimit=1&format=json&origin=*`
        );
        const searchJson = await searchRes.json();
        if (searchJson.query && searchJson.query.search && searchJson.query.search.length > 0) {
          const bestTitle = searchJson.query.search[0].title;
          const detailRes = await fetch(
            `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages|extracts&titles=${encodeURIComponent(bestTitle)}&format=json&origin=*&exintro=true&explaintext=true&piprop=original`
          );
          const detailJson = await detailRes.json();
          if (detailJson.query && detailJson.query.pages) {
            const pid = Object.keys(detailJson.query.pages)[0];
            if (pid !== '-1') {
              const page = detailJson.query.pages[pid];
              fetchedDetails.name = page.title || place.name;
              fetchedDetails.description = page.extract || 'Details not available';
              fetchedDetails.image = page.original ? page.original.source : null;
            }
          }
        }
      } catch (wikiSearch) { /* keep defaults */ }
    }

    setDetailsData(fetchedDetails);

    // ── Fetch Nearby Services (Async, non-blocking) ───────────────────────────
    if (placeLat && placeLon) {
      fetchNearbyServices(placeLat, placeLon).then(services => {
        if (services && services.length > 0) {
          setNearbyServices(services);
        }
      });
    }

    // ── Nearby Places via Overpass (5km radius) ───────────────────────────
    let nearbyFetched = false;
    if (placeLat && placeLon) {
      try {
        const rawNearby = await fetchOverpassPlaces(placeLat, placeLon, 5000);
        const filtered = rawNearby
          .filter(p => p.name.toLowerCase() !== place.name.toLowerCase())
          .map(p => ({
            ...p,
            snippet: p.description || p.type || 'Nearby attraction',
            distance: haversine(placeLat, placeLon, p.latitude, p.longitude).toFixed(1)
          }))
          .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        if (filtered.length > 0) {
          console.log('Overpass nearby places:', filtered.length);
          setNearbyPlaces(filtered);
          nearbyFetched = true;
        }
      } catch (e) {
        console.warn('Overpass nearby failed, falling back to Wikipedia', e);
      }
    }

      // Fallback to Wikipedia search for nearby
      if (!nearbyFetched) {
        const stateQuery = activeCity || '';
        const nearbyRes = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(place.name + ' tourist places in ' + stateQuery)}&format=json&origin=*`
        );
        const nearbyJson = await nearbyRes.json();
        if (nearbyJson.query && nearbyJson.query.search) {
          const searchResults = filterWikipediaResults(nearbyJson.query.search, stateQuery)
            .filter(r => r.title.toLowerCase() !== place.name.toLowerCase());
          const enrichedNearby = [];
          for (const res of searchResults) {
            let nLat = null, nLon = null;
            try {
              const gRes = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(res.title)}&format=json&limit=1`,
                { headers: { 'User-Agent': 'TravelEaseApp' } }
              );
              const gData = await gRes.json();
              if (gData && gData.length > 0) { nLat = parseFloat(gData[0].lat); nLon = parseFloat(gData[0].lon); }
            } catch (e) { /* no coords */ }
            const dist = (placeLat && placeLon && nLat && nLon)
              ? haversine(placeLat, placeLon, nLat, nLon).toFixed(1)
              : null;
            enrichedNearby.push({
              id: `wiki_${res.pageid}`,
              name: res.title,
              description: res.snippet ? res.snippet.replace(/<[^>]+>/g, '') : '',
              snippet: res.snippet,
              latitude: nLat,
              longitude: nLon,
              distance: dist
            });
          }
          // Apply same cleaning to nearby results
          const cleanedNearby = cleanPlaces(enrichedNearby, stateQuery);
          cleanedNearby.sort((a, b) => {
            if (a.distance === null) return 1;
            if (b.distance === null) return -1;
            return parseFloat(a.distance) - parseFloat(b.distance);
          });
          setNearbyPlaces(cleanedNearby);
        }
      }

    } catch (err) {
      console.error("Details fetch error:", err);
      setDetailsData(prev => prev ? { ...prev, description: "Details not available" } : {
        name: place.name,
        description: "Details not available",
        image: null
      });
    } finally {
      setDetailsLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1400px] w-full mx-auto flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">

      {/* ── Hero Header ── */}
      <div className="bg-gradient-to-br from-slate-900 via-teal-900 to-blue-900 p-10 md:p-12 rounded-[2rem] shadow-2xl shadow-teal-900/20 border border-white/10 relative overflow-hidden group">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay"></div>
        <div className="absolute top-0 right-0 opacity-5 text-[220px] leading-none translate-x-12 -translate-y-8 pointer-events-none group-hover:rotate-12 group-hover:scale-110 transition-transform duration-1000 select-none">🗺️</div>
        <h2 className="text-4xl md:text-5xl font-black text-white mb-3 tracking-tight relative z-10 drop-shadow-md">Trip Planner</h2>
        <p className="text-teal-100 text-lg relative z-10 max-w-2xl font-medium">Pick your city, set your days, select places — get an optimized day-by-day itinerary.</p>

        {/* ── Input row ── */}
        <div className="mt-8 flex flex-col md:flex-row gap-5 relative z-10">
          {/* City dropdown */}
          <div className="flex-1 group/input">
            <label className="block text-xs font-black text-teal-300 uppercase tracking-widest mb-2 opacity-80">City</label>
            <select
              className="w-full px-5 py-4 rounded-2xl font-extrabold text-slate-800 bg-white/90 backdrop-blur-md shadow-lg outline-none appearance-none cursor-pointer border border-white/20 transition-all hover:bg-white focus:ring-4 focus:ring-teal-500/30"
              value={city}
              onChange={e => { setCity(e.target.value); setCustomCity(''); setUseLocation(false); setLocStatus(''); }}
            >
              <option value="">— Choose a city —</option>
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Custom city input */}
          <div className="flex-1 group/input">
            <label className="block text-xs font-black text-teal-300 uppercase tracking-widest mb-2 opacity-80">Or type city</label>
            <input
              type="text"
              placeholder="e.g. Mysore, Pune..."
              className="w-full px-5 py-4 rounded-2xl font-bold text-slate-800 bg-white/90 backdrop-blur-md shadow-lg outline-none border border-white/20 transition-all hover:bg-white focus:ring-4 focus:ring-teal-500/30 placeholder-slate-400"
              value={customCity}
              onChange={e => { setCustomCity(e.target.value); setCity(e.target.value); }}
            />
          </div>

          {/* Use GPS button */}
          <div className="flex flex-col justify-end gap-1">
            <label className="block text-xs font-black text-teal-300 uppercase tracking-widest mb-2 opacity-80 hidden md:block">&nbsp;</label>
            <button
              onClick={handleUseLocation}
              className="w-full md:w-auto px-6 py-4 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-extrabold rounded-2xl transition-all duration-300 backdrop-blur-md whitespace-nowrap shadow-lg hover:-translate-y-0.5 active:scale-95 flex items-center justify-center gap-2"
            >
              <span className="animate-pulse">📍</span> Detect Location
            </button>
          </div>

          {/* Number of days */}
          <div className="w-full md:w-32 group/input">
            <label className="block text-xs font-black text-teal-300 uppercase tracking-widest mb-2 opacity-80 border-b border-transparent">Days</label>
            <input
              type="number"
              min="1"
              max="30"
              value={days}
              onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-5 py-4 rounded-2xl font-extrabold text-slate-800 bg-white/90 backdrop-blur-md shadow-lg outline-none text-center text-xl border border-white/20 transition-all hover:bg-white focus:ring-4 focus:ring-teal-500/30"
            />
          </div>
        </div>

        {locStatus && (
          <p className="mt-5 text-sm font-bold text-teal-100 bg-white/10 px-5 py-2.5 rounded-xl inline-flex items-center gap-2 border border-white/20 relative z-10 backdrop-blur-sm shadow-inner animate-in zoom-in-95 duration-300">
            {locStatus}
          </p>
        )}
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex gap-2 bg-slate-200/50 p-1.5 rounded-2xl w-fit border border-slate-200 shadow-inner backdrop-blur-sm">
        <button
          onClick={() => setTab('plan')}
          className={`px-8 py-3 rounded-xl font-black transition-all duration-300 text-sm ${tab === 'plan' ? 'bg-white shadow-md text-teal-700 scale-100' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50 scale-95'}`}
        >
          🗺️ Plan Trip
        </button>
        <button
          onClick={() => setTab('saved')}
          className={`px-8 py-3 rounded-xl font-black transition-all duration-300 text-sm flex items-center gap-2 ${tab === 'saved' ? 'bg-white shadow-md text-blue-700 scale-100' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50 scale-95'}`}
        >
          📂 My Trips
          {savedTrips.length > 0 && (
            <span className="bg-gradient-to-r from-blue-500 to-teal-500 text-white text-[10px] px-2.5 py-0.5 rounded-full font-black shadow-inner">{savedTrips.length}</span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: PLAN
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'plan' && (
        <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in duration-500">

          {/* Left — Place picker */}
          <div className="lg:w-2/3 bg-white p-8 md:p-10 rounded-[2rem] shadow-xl border border-slate-100 min-h-[600px] relative transition-all">
            <h3 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-4 border-b border-slate-100 pb-5">
              <span className="bg-blue-50 text-blue-600 p-3 rounded-2xl shadow-sm border border-blue-100">📍</span>
              {activeCity ? `Discover ${activeCity}` : 'Select a destination'}
            </h3>

            {/* Success label (not an error) */}
            {placesLabel && places.length > 0 && (
              <p className="text-xs font-black text-teal-700 uppercase tracking-widest bg-teal-50 border border-teal-100 px-4 py-2 rounded-xl mb-6 inline-block shadow-sm">
                ✅ {placesLabel} • {places.length} Spots
              </p>
            )}

            {!activeCity ? (
              <div className="flex flex-col items-center justify-center py-32 text-slate-400 font-black text-xl border-2 border-dashed border-slate-200 rounded-[2rem] bg-slate-50/50 gap-5 transition-all">
                <span className="text-6xl opacity-30 animate-bounce">🧭</span>
                Ready for an adventure?
              </div>
            ) : loadingPlaces ? (
              <div className="flex flex-col items-center justify-center py-32 gap-6">
                <div className="relative flex justify-center items-center">
                  <div className="w-16 h-16 border-4 border-teal-100 rounded-full" />
                  <div className="w-16 h-16 border-4 border-teal-500 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
                </div>
                <p className="text-slate-500 font-extrabold tracking-wide uppercase animate-pulse text-sm">Discovering locations...</p>
              </div>
            ) : placesError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl font-bold text-sm shadow-inner">
                <p className="text-base text-center">⚠️ {placesError}</p>
              </div>
            ) : places.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 text-slate-400 font-black text-lg border-2 border-dashed border-slate-200 rounded-[2rem] bg-slate-50/50 gap-5">
                <span className="text-5xl opacity-30">🔍</span>
                No places found. Try another city.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 auto-rows-max">
                {places.map((place, idx) => {
                  const orderIdx = selectedPlaces.findIndex(p => p.id === place.id);
                  const isSelected = orderIdx >= 0;
                  return (
                    <div
                      key={place.id}
                      onClick={() => handleOpenDetails(place)}
                      className={`cursor-pointer border-2 rounded-[1.5rem] p-5 relative overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl group ${isSelected ? 'border-teal-500 bg-teal-50/50 shadow-md ring-4 ring-teal-500/10' : 'border-slate-100 bg-white hover:border-teal-300'}`}
                    >
                      {/* Order badge */}
                      {isSelected && (
                        <div className="absolute -right-5 -top-5 bg-gradient-to-br from-teal-400 to-teal-600 text-white w-16 h-16 rounded-full flex items-end justify-center pb-2 pl-2 font-black text-xl rotate-12 shadow-lg border-[3px] border-white z-10 transition-transform group-hover:scale-110">
                          #{orderIdx + 1}
                        </div>
                      )}
                      <h4 className={`font-extrabold text-xl mb-1 pr-8 truncate transition-colors ${isSelected ? 'text-teal-900' : 'text-slate-800 group-hover:text-teal-700'}`}>{place.name}</h4>
                      {place.description && (
                        <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed mb-4">{place.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {place.openingTime && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-50 border border-slate-200 text-slate-600 px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                            <span className="opacity-70">🕒</span> {place.openingTime}{place.closingTime ? ` – ${place.closingTime}` : ''}
                          </span>
                        )}
                        {place.bestTime && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                            <span className="opacity-70">⭐</span> {place.bestTime}
                          </span>
                        )}
                        {place.latitude && place.longitude && (
                          <span className="text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                            <span className="animate-pulse">📌</span> GPS
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right — Itinerary builder + generate */}
          <div className="lg:w-1/3 flex flex-col gap-6 sticky top-[100px] h-fit">

            {/* Selected places stack */}
            <div className="bg-slate-50/80 backdrop-blur-md p-8 rounded-[2rem] shadow-inner border border-slate-200">
              <h3 className="text-xl font-black text-slate-800 mb-5 flex items-center justify-between">
                <span className="flex items-center gap-3">
                  <span className="bg-teal-100 text-teal-700 p-2.5 rounded-xl shadow-sm border border-teal-200">📋</span>
                  Selected
                </span>
                <span className="bg-teal-600 text-white text-sm px-3 py-1 rounded-full font-bold shadow-inner">{selectedPlaces.length}</span>
              </h3>

              {selectedPlaces.length === 0 ? (
                <div className="text-center text-slate-400 py-12 font-bold border-2 border-dashed border-slate-300 rounded-2xl bg-white/50 text-sm">
                  Click places on the left to add them
                </div>
              ) : (
                <div className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                  {selectedPlaces.map((p, i) => (
                    <div key={p.id} className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-3 group relative transition-all hover:border-teal-300 hover:shadow-md">
                      <div className="bg-gradient-to-br from-teal-400 to-teal-600 text-white font-black w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-sm shadow-sm border border-teal-500/50">
                        {i + 1}
                      </div>
                      <span className="font-extrabold text-slate-700 truncate text-sm pr-6 group-hover:text-teal-700 transition-colors">{p.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePlace(p); }}
                        className="absolute right-3 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white w-7 h-7 rounded-lg font-black opacity-0 group-hover:opacity-100 transition-all shadow-sm flex items-center justify-center border border-red-100 hover:border-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={`mt-6 w-full font-black py-4 rounded-[1.5rem] shadow-lg transition-all duration-300 text-base relative overflow-hidden group/gen ${
                  canGenerate
                    ? 'bg-gradient-to-r from-blue-600 to-teal-500 text-white hover:shadow-teal-500/40 hover:-translate-y-1 active:scale-95'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-70'
                }`}
              >
                {canGenerate && <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover/gen:translate-x-[100%] transition-transform duration-700 ease-in-out" />}
                ⚡ Generate {days}-Day Plan
              </button>
            </div>

            {/* Generated itinerary preview */}
            {itinerary && (
              <div className="bg-white border-2 border-teal-500 rounded-[2rem] shadow-2xl shadow-teal-500/10 p-8 relative overflow-hidden animate-in slide-in-from-right-8 duration-500">
                <div className="absolute -top-10 -right-10 opacity-5 text-[150px] pointer-events-none">✨</div>
                <h3 className="text-xl font-black text-teal-800 mb-6 flex items-center justify-between relative z-10">
                  <span className="flex items-center gap-2">✅ Optimized Plan</span>
                  <span className="text-xs bg-teal-100 border border-teal-200 text-teal-700 px-3 py-1 rounded-full font-bold shadow-sm">
                    {days} day{days > 1 ? 's' : ''}
                  </span>
                </h3>
                <div className="flex flex-col gap-6 max-h-80 overflow-y-auto pr-2 custom-scrollbar relative z-10">
                  {itinerary.map(dayObj => (
                    <div key={dayObj.day} className="bg-teal-50/50 p-4 rounded-2xl border border-teal-100">
                      <p className="text-xs font-black uppercase tracking-widest text-teal-700 bg-white px-3 py-1.5 rounded-xl mb-3 border border-teal-100 shadow-sm inline-block">
                        Day {dayObj.day}
                      </p>
                      <div className="flex flex-col gap-2 pl-1">
                        {dayObj.places.map((p, i) => (
                          <div key={p.id} className="text-sm font-bold text-slate-700 flex items-start gap-3 bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm">
                            <span className="text-teal-600 font-black shrink-0 bg-teal-50 w-6 h-6 flex items-center justify-center rounded-md border border-teal-100">{i + 1}</span>
                            <span className="mt-0.5">{p.name}</span>
                            {p.openingTime && (
                              <span className="text-[10px] text-slate-400 ml-auto shrink-0 mt-1 font-bold bg-slate-50 px-2 py-0.5 rounded">{p.openingTime}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save feedback + button */}
            {saveMsg && (
              <div className={`px-5 py-4 rounded-xl font-black text-sm border flex items-center gap-3 shadow-sm animate-in zoom-in-95 ${
                saveMsg.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}>
                <span className="text-xl">{saveMsg.type === 'success' ? '🚀' : '⚠️'}</span> {saveMsg.text}
              </div>
            )}

            <button
              onClick={handleSaveTrip}
              disabled={!canSave || saving}
              className={`w-full font-black py-4.5 rounded-[1.5rem] shadow-xl text-lg transition-all duration-300 relative overflow-hidden group/save ${
                canSave && !saving
                  ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:shadow-emerald-500/40 hover:-translate-y-1 active:scale-95'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-70 py-4'
              }`}
            >
              {canSave && !saving && <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover/save:translate-x-[100%] transition-transform duration-700 ease-in-out" />}
              {saving ? (
                <span className="flex items-center justify-center gap-3 py-4"><span className="w-5 h-5 border-4 border-white border-t-transparent rounded-full animate-spin"></span> Saving...</span>
              ) : '💾 Save Trip to Profile'}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: SAVED TRIPS
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'saved' && (
        <div className="bg-white p-8 md:p-12 rounded-[2rem] shadow-xl border border-slate-100 relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
          <div className="absolute -top-10 -right-10 opacity-5 text-[200px] pointer-events-none rotate-12 select-none">🗄️</div>
          <h2 className="text-3xl font-black text-slate-800 mb-8 tracking-tight relative z-10 flex items-center gap-4">
            <span className="bg-blue-50 text-blue-600 p-3 rounded-2xl shadow-sm border border-blue-100">📂</span>
            My Saved Trips
          </h2>

          {loadingTrips ? (
            <div className="flex items-center justify-center py-20 gap-6">
              <div className="relative flex justify-center items-center">
                <div className="w-16 h-16 border-4 border-teal-100 rounded-full" />
                <div className="w-16 h-16 border-4 border-teal-500 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
              </div>
              <p className="text-slate-500 font-extrabold tracking-wide uppercase animate-pulse">Loading trips...</p>
            </div>
          ) : savedTrips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 bg-slate-50/50 rounded-[2rem] border-2 border-dashed border-slate-200 gap-5">
              <span className="text-6xl opacity-30 animate-bounce">📂</span>
              <p className="text-slate-500 font-black text-xl text-center">No trips saved yet. Plan and save your first trip!</p>
              <button
                onClick={() => setTab('plan')}
                className="mt-4 bg-gradient-to-r from-teal-500 to-blue-500 text-white font-black px-8 py-4 rounded-xl shadow-lg hover:shadow-teal-500/30 hover:-translate-y-1 active:scale-95 transition-all duration-300"
              >
                Start Planning
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
              {savedTrips.map(trip => (
                <div key={trip.id} className="border border-gray-200 rounded-2xl overflow-hidden shadow hover:shadow-xl transition-all duration-300 bg-white hover:-translate-y-1 flex flex-col">
                  {/* Card header */}
                  <div className="bg-gradient-to-r from-teal-50 to-blue-50 p-5 border-b border-gray-100 flex justify-between items-start">
                    <div>
                      <h3 className="font-extrabold text-2xl text-teal-900 flex items-center gap-2 tracking-tight">
                        <span className="bg-teal-500 w-3 h-3 rounded-full animate-pulse" />
                        {trip.city}
                      </h3>
                      <div className="flex gap-2 mt-2">
                        <span className="text-xs font-bold bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">
                          {trip.days || 1} day{(trip.days || 1) > 1 ? 's' : ''}
                        </span>
                        <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {trip.places?.length || 0} stops
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteTrip(trip.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors font-bold text-lg leading-none p-1"
                      title="Delete trip"
                    >
                      🗑
                    </button>
                  </div>

                  {/* Places timeline */}
                  <div className="p-5 flex-grow">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
                      {new Date(trip.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>

                    {/* Day-based or flat list */}
                    {trip.itinerary ? (
                      <div className="flex flex-col gap-3">
                        {trip.itinerary.map(d => (
                          <div key={d.day}>
                            <p className="text-[10px] font-black uppercase tracking-wider text-teal-600 mb-1.5">Day {d.day}</p>
                            <div className="border-l-2 border-teal-100 pl-3 flex flex-col gap-1">
                              {d.places.map((p, i) => (
                                <p key={i} className="text-sm font-bold text-gray-700 truncate">
                                  <span className="text-teal-400 mr-1">{i + 1}.</span>{p.name}
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="border-l-2 border-teal-200 pl-4 flex flex-col gap-2">
                        {trip.places?.map((p, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <div className="bg-white border-2 border-teal-400 text-teal-700 font-black text-[10px] w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5">
                              {i + 1}
                            </div>
                            <div>
                              <p className="font-extrabold text-gray-900 text-sm leading-tight truncate">{p.name}</p>
                              {p.description && (
                                <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{p.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Place Details Modal ── */}
      {detailsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setDetailsModal(null)}>
          <div className="bg-white rounded-[2rem] shadow-2xl shadow-black/40 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden relative animate-in zoom-in-95 slide-in-from-bottom-10 duration-500" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80 backdrop-blur-sm shrink-0">
              <h3 className="text-2xl font-black text-slate-800 pr-8 line-clamp-1 flex items-center gap-3">
                <span className="bg-teal-100 text-teal-700 p-2 rounded-xl shadow-sm border border-teal-200 text-base">📌</span>
                {detailsModal.name}
              </h3>
              <button 
                onClick={() => setDetailsModal(null)} 
                className="text-slate-400 hover:text-white hover:bg-red-500 font-black bg-slate-200 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 transform hover:rotate-90 active:scale-95"
                title="Close"
              >✕</button>
            </div>

            {/* Body */}
            <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar">
              {detailsLoading ? (
                <div className="py-20 flex flex-col items-center justify-center text-slate-400 font-black gap-6">
                  <div className="relative flex justify-center items-center">
                    <div className="w-16 h-16 border-4 border-teal-100 rounded-full" />
                    <div className="w-16 h-16 border-4 border-teal-500 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
                  </div>
                  Loading destination intel...
                </div>
              ) : detailsData ? (
                <div className="flex flex-col gap-8">
                  {/* Image */}
                  {detailsData.image ? (
                    <div className="relative w-full h-72 rounded-[1.5rem] shadow-lg overflow-hidden group">
                      <img src={detailsData.image} alt={detailsData.name} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    </div>
                  ) : (
                    <div className="w-full h-56 bg-slate-50 rounded-[1.5rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 font-black gap-3 transition-colors hover:bg-slate-100 hover:border-slate-300">
                      <span className="text-5xl opacity-40">📷</span>
                      No Image Available
                    </div>
                  )}
                  
                  {/* Description */}
                  <div className="bg-slate-50 p-6 rounded-[1.5rem] border border-slate-100">
                    <h4 className="text-xs font-black text-teal-600 uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-slate-200 pb-3">
                      <span className="bg-teal-100 p-1.5 rounded-lg">ℹ️</span> About this Location
                    </h4>
                    <p className="text-slate-700 leading-relaxed text-sm whitespace-pre-wrap font-medium">
                      {detailsData.description === "Details not available" && detailsModal.description 
                        ? detailsModal.description 
                        : detailsData.description}
                    </p>
                  </div>

                  {/* Add to Trip Action */}
                  <button
                    onClick={() => { togglePlace(detailsModal); setDetailsModal(null); }}
                    className={`w-full py-4.5 font-black rounded-[1.5rem] shadow-xl text-lg transition-all duration-300 hover:-translate-y-1 active:scale-95 ${selectedPlaces.some(p => p.id === detailsModal.id) ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-500 hover:text-white shadow-red-500/10' : 'bg-gradient-to-r from-teal-500 to-blue-500 text-white shadow-teal-500/30'}`}
                  >
                    {selectedPlaces.some(p => p.id === detailsModal.id) ? '🚫 Remove from Itinerary' : '✨ Add to Itinerary'}
                  </button>

                  {/* Nearby Places */}
                  {nearbyPlaces.length > 0 ? (
                    <div className="mt-4">
                      <h4 className="text-xs font-black text-teal-600 uppercase tracking-widest mb-4">Nearby Places</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {nearbyPlaces.map((np, i) => (
                          <div 
                            key={i} 
                            onClick={() => handleOpenDetails({ name: np.name, id: np.id, latitude: np.latitude, longitude: np.longitude, description: np.snippet })}
                            className="bg-blue-50 border border-blue-100 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                          >
                            <span className="font-bold text-blue-900 block truncate text-sm mb-1">{np.name}</span>
                            <span className="text-xs text-blue-700 line-clamp-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: np.snippet }}></span>
                            {np.distance && <span className="block mt-2 text-xs font-black text-teal-700">📍 {np.distance} km away</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 text-sm font-bold text-gray-400">No nearby places</div>
                  )}

                  {/* Nearby Services */}
                  {nearbyServices.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-black text-teal-600 uppercase tracking-widest mb-4">Essential Services Nearby</h4>
                      <div className="flex flex-col gap-3">
                        {['restaurant', 'hotel', 'hospital', 'atm', 'police'].map((cat) => {
                          const items = nearbyServices.filter(s => s.type === cat || (cat === 'hotel' && s.type === 'guest_house'));
                          if (items.length === 0) return null;
                          const icon = cat === 'restaurant' ? '🍽️' : cat === 'hotel' ? '🏨' : cat === 'hospital' ? '🏥' : cat === 'atm' ? '💳' : '🚓';
                          const catName = cat === 'hospital' || cat === 'restaurant' ? cat + 's' : (cat === 'police' ? 'Police' : cat.toUpperCase());
                          
                          return (
                            <div key={cat} className="bg-gray-50 border border-gray-100 p-4 rounded-xl">
                              <h5 className="font-extrabold text-gray-800 text-sm mb-2 capitalize flex items-center gap-2">{icon} {catName}</h5>
                              <div className="flex flex-col gap-2">
                                {items.slice(0, 5).map((s, idx) => (
                                  <div key={idx} className="flex justify-between items-center text-sm">
                                    <span className="font-bold text-gray-700 truncate pr-2">{s.name}</span>
                                    <span className="text-xs font-black text-teal-600 shrink-0 bg-teal-50 px-2 py-0.5 rounded">{s.distance} km</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center font-bold text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">Details not available</div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TripPlanner;

import React, { useState, useEffect, useCallback } from 'react';
import RoleHeader from './RoleHeader';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { motion } from 'framer-motion';

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

// (Wikipedia Filter Helper removed)

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

const fetchOverpassPlaces = async (lat, lon, radius = 25000) => {
  const getQuery = (rad) => `[out:json][timeout:30];
(
  node["tourism"="attraction"](around:${rad},${lat},${lon});
  way["tourism"="attraction"](around:${rad},${lat},${lon});
  node["tourism"="museum"](around:${rad},${lat},${lon});
  way["tourism"="museum"](around:${rad},${lat},${lon});
  node["historic"="monument"](around:${rad},${lat},${lon});
  way["historic"="monument"](around:${rad},${lat},${lon});
  node["historic"="castle"](around:${rad},${lat},${lon});
  way["historic"="castle"](around:${rad},${lat},${lon});
  node["historic"="fort"](around:${rad},${lat},${lon});
  way["historic"="fort"](around:${rad},${lat},${lon});
  node["historic"="ruins"](around:${rad},${lat},${lon});
  way["historic"="ruins"](around:${rad},${lat},${lon});
  node["leisure"="park"](around:${rad},${lat},${lon});
  way["leisure"="park"](around:${rad},${lat},${lon});
  node["leisure"="garden"](around:${rad},${lat},${lon});
  way["leisure"="garden"](around:${rad},${lat},${lon});
  node["natural"="water"](around:${rad},${lat},${lon});
  way["natural"="water"](around:${rad},${lat},${lon});
  node["natural"="beach"](around:${rad},${lat},${lon});
  way["natural"="beach"](around:${rad},${lat},${lon});
  node["waterway"="waterfall"](around:${rad},${lat},${lon});
  way["waterway"="waterfall"](around:${rad},${lat},${lon});
  node["tourism"="zoo"](around:${rad},${lat},${lon});
  way["tourism"="zoo"](around:${rad},${lat},${lon});
  node["amenity"="place_of_worship"](around:${rad},${lat},${lon});
  way["amenity"="place_of_worship"](around:${rad},${lat},${lon});
);
out center 100;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: getQuery(radius),
      headers: { 'Content-Type': 'text/plain' }
    });
    const data = await res.json();
    console.log('Overpass response:', data);

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
      if (!isValidOsmName(name)) continue;
      if (seen.has(name.toLowerCase())) continue;
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (!elLat || !elLon) continue;

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
  } catch (err) {
    console.error("Overpass fetch failed:", err);
    return [];
  }
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
const PLACE_BAD_WORDS  = ['tourism','history','culture','movie','film','song','list of','overview','district','state','india','wikipedia','article'];

const cleanPlaces = (places, state = '') => {
  let cleaned = places.filter(p => {
    if (!p.name || p.name.trim().length < 3) return false;
    if (!p.latitude || !p.longitude) return false;
    const nameLower = p.name.toLowerCase();
    if (PLACE_BAD_WORDS.some(b => nameLower.includes(b))) return false;
    return true;
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

        // 3. Fetch Places via Overpass API (Strict Geolocation)
        let list = [];
        try {
          const overpassPlaces = await fetchOverpassPlaces(lat, lon, 25000);
          console.log('Overpass places found:', overpassPlaces.length);

          if (overpassPlaces.length > 0) {
            // Enrich top 30 with Wikipedia descriptions/images only using EXACT names
            list = await enrichWithWikipedia(overpassPlaces.slice(0, 30));
            if (isMounted) setPlacesLabel(`Showing top tourist places near ${city}`);
          } else {
            if (isMounted) setPlacesError('No real tourist places found in this strict area. Try zooming out or a major city.');
            setPlaces([]);
            setLoadingPlaces(false);
            return;
          }
        } catch (apiErr) {
          console.error('Places fetch error:', apiErr);
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

      // Wikipedia search fallback removed to strictly enforce real POIs

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
    <div className="max-w-[1400px] w-full mx-auto flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out text-slate-200">

      {/* ── Hero Header ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-10 md:p-12 rounded-[2rem] shadow-2xl relative overflow-hidden group border border-cyan-500/30">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 mix-blend-overlay"></div>
        <div className="absolute top-0 right-0 opacity-10 text-[220px] leading-none translate-x-12 -translate-y-8 pointer-events-none group-hover:rotate-12 group-hover:scale-110 transition-transform duration-1000 select-none drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]">🗺️</div>
        <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400 mb-3 tracking-tight relative z-10 drop-shadow-md">Trip Planner</h2>
        <p className="text-cyan-100 text-lg relative z-10 max-w-2xl font-medium">Pick your city, set your days, select places — get an optimized day-by-day itinerary.</p>

        {/* ── Input row ── */}
        <div className="mt-8 flex flex-col md:flex-row gap-5 relative z-10">
          {/* City dropdown */}
          <div className="flex-1 group/input">
            <label className="block text-xs font-black text-cyan-300 uppercase tracking-widest mb-2 opacity-80">City</label>
            <select
              className="glass-input w-full px-5 py-4 rounded-2xl font-extrabold appearance-none cursor-pointer"
              value={city}
              onChange={e => { setCity(e.target.value); setCustomCity(''); setUseLocation(false); setLocStatus(''); }}
            >
              <option value="" className="bg-slate-900">— Choose a city —</option>
              {CITIES.map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
            </select>
          </div>

          {/* Custom city input */}
          <div className="flex-1 group/input">
            <label className="block text-xs font-black text-cyan-300 uppercase tracking-widest mb-2 opacity-80">Or type city</label>
            <input
              type="text"
              placeholder="e.g. Mysore, Pune..."
              className="glass-input w-full px-5 py-4 rounded-2xl font-bold placeholder-slate-500"
              value={customCity}
              onChange={e => { setCustomCity(e.target.value); setCity(e.target.value); }}
            />
          </div>

          {/* Use GPS button */}
          <div className="flex flex-col justify-end gap-1">
            <label className="block text-xs font-black text-cyan-300 uppercase tracking-widest mb-2 opacity-80 hidden md:block">&nbsp;</label>
            <button
              onClick={handleUseLocation}
              className="w-full md:w-auto px-6 py-4 bg-cyan-600/80 hover:bg-cyan-500 border border-cyan-400/50 text-white font-extrabold rounded-2xl transition-all duration-300 backdrop-blur-md whitespace-nowrap shadow-lg hover:-translate-y-0.5 active:scale-95 flex items-center justify-center gap-2"
            >
              <span className="animate-pulse">📍</span> Detect Location
            </button>
          </div>

          {/* Number of days */}
          <div className="w-full md:w-32 group/input">
            <label className="block text-xs font-black text-cyan-300 uppercase tracking-widest mb-2 opacity-80 border-b border-transparent">Days</label>
            <input
              type="number"
              min="1"
              max="30"
              value={days}
              onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))}
              className="glass-input w-full px-5 py-4 rounded-2xl text-center text-xl"
            />
          </div>
        </div>

        {locStatus && (
          <p className="mt-5 text-sm font-bold text-cyan-100 bg-slate-900/50 px-5 py-2.5 rounded-xl inline-flex items-center gap-2 border border-cyan-500/30 relative z-10 backdrop-blur-sm shadow-inner animate-in zoom-in-95 duration-300">
            {locStatus}
          </p>
        )}
      </motion.div>

      {/* ── Tab switcher ── */}
      <div className="flex gap-2 glass-panel p-1.5 rounded-2xl w-fit">
        <button
          onClick={() => setTab('plan')}
          className={`px-8 py-3 rounded-xl font-black transition-all duration-300 text-sm ${tab === 'plan' ? 'bg-cyan-600/50 shadow-md text-white border border-cyan-500/50 scale-100' : 'text-slate-400 hover:text-slate-200 hover:bg-white/10 scale-95 border border-transparent'}`}
        >
          🗺️ Plan Trip
        </button>
        <button
          onClick={() => setTab('saved')}
          className={`px-8 py-3 rounded-xl font-black transition-all duration-300 text-sm flex items-center gap-2 ${tab === 'saved' ? 'bg-cyan-600/50 shadow-md text-white border border-cyan-500/50 scale-100' : 'text-slate-400 hover:text-slate-200 hover:bg-white/10 scale-95 border border-transparent'}`}
        >
          📂 My Trips
          {savedTrips.length > 0 && (
            <span className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-[10px] px-2.5 py-0.5 rounded-full font-black shadow-inner border border-white/20">{savedTrips.length}</span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: PLAN
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'plan' && (
        <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in duration-500">

          {/* Left — Place picker */}
          <div className="lg:w-2/3 glass-panel p-8 md:p-10 rounded-[2rem] min-h-[600px] relative transition-all">
            <h3 className="text-2xl font-black text-white mb-6 flex items-center gap-4 border-b border-white/10 pb-5">
              <span className="bg-cyan-900/50 text-cyan-300 p-3 rounded-2xl shadow-sm border border-cyan-500/30">📍</span>
              {activeCity ? `Discover ${activeCity}` : 'Select a destination'}
            </h3>

            {/* Success label (not an error) */}
            {placesLabel && places.length > 0 && (
              <p className="text-xs font-black text-cyan-300 uppercase tracking-widest bg-cyan-900/30 border border-cyan-500/30 px-4 py-2 rounded-xl mb-6 inline-block shadow-sm">
                ✅ {placesLabel} • {places.length} Spots
              </p>
            )}

            {!activeCity ? (
              <div className="flex flex-col items-center justify-center py-32 text-slate-500 font-black text-xl border-2 border-dashed border-white/10 rounded-[2rem] bg-slate-900/30 gap-5 transition-all">
                <span className="text-6xl opacity-30 animate-bounce">🧭</span>
                Ready for an adventure?
              </div>
            ) : loadingPlaces ? (
              <div className="flex flex-col items-center justify-center py-32 gap-6">
                <div className="relative flex justify-center items-center">
                  <div className="w-16 h-16 border-4 border-cyan-500/30 rounded-full" />
                  <div className="w-16 h-16 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
                </div>
                <p className="text-slate-400 font-extrabold tracking-wide uppercase animate-pulse text-sm">Discovering locations...</p>
              </div>
            ) : placesError ? (
              <div className="bg-red-900/30 border border-red-500/50 text-red-300 p-6 rounded-2xl font-bold text-sm shadow-inner">
                <p className="text-base text-center">⚠️ {placesError}</p>
              </div>
            ) : places.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 text-slate-500 font-black text-lg border-2 border-dashed border-white/10 rounded-[2rem] bg-slate-900/30 gap-5">
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
                      className={`cursor-pointer border rounded-[1.5rem] p-5 relative overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl group ${isSelected ? 'border-cyan-400 bg-cyan-900/30 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-white/10 bg-slate-900/50 hover:border-cyan-400/50'}`}
                    >
                      {/* Order badge */}
                      {isSelected && (
                        <div className="absolute -right-5 -top-5 bg-gradient-to-br from-cyan-400 to-blue-600 text-white w-16 h-16 rounded-full flex items-end justify-center pb-2 pl-2 font-black text-xl rotate-12 shadow-lg border-[3px] border-white/20 z-10 transition-transform group-hover:scale-110">
                          #{orderIdx + 1}
                        </div>
                      )}
                      <h4 className={`font-extrabold text-xl mb-1 pr-8 truncate transition-colors ${isSelected ? 'text-white' : 'text-slate-300 group-hover:text-white'}`}>{place.name}</h4>
                      {place.description && (
                        <p className="text-sm text-slate-400 line-clamp-2 leading-relaxed mb-4">{place.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {place.openingTime && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-800 border border-white/10 text-slate-300 px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                            <span className="opacity-70">🕒</span> {place.openingTime}{place.closingTime ? ` – ${place.closingTime}` : ''}
                          </span>
                        )}
                        {place.bestTime && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-900/30 border border-amber-500/30 text-amber-400 px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                            <span className="opacity-70">⭐</span> {place.bestTime}
                          </span>
                        )}
                        {place.latitude && place.longitude && (
                          <span className="text-[10px] font-bold bg-blue-900/30 border border-blue-500/30 text-blue-400 px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm">
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
            <div className="glass-panel backdrop-blur-md p-8 rounded-[2rem] shadow-inner border border-white/10">
              <h3 className="text-xl font-black text-white mb-5 flex items-center justify-between">
                <span className="flex items-center gap-3">
                  <span className="bg-cyan-900/50 text-cyan-300 p-2.5 rounded-xl shadow-sm border border-cyan-500/30">📋</span>
                  Selected
                </span>
                <span className="bg-cyan-600 text-white text-sm px-3 py-1 rounded-full font-bold shadow-inner">{selectedPlaces.length}</span>
              </h3>

              {selectedPlaces.length === 0 ? (
                <div className="text-center text-slate-500 py-12 font-bold border-2 border-dashed border-white/10 rounded-2xl bg-slate-900/30 text-sm">
                  Click places on the left to add them
                </div>
              ) : (
                <div className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                  {selectedPlaces.map((p, i) => (
                    <div key={p.id} className="bg-slate-900/50 p-3.5 rounded-2xl shadow-sm border border-white/10 flex items-center gap-3 group relative transition-all hover:border-cyan-400/50 hover:shadow-md">
                      <div className="bg-gradient-to-br from-cyan-400 to-blue-600 text-white font-black w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-sm shadow-sm border border-white/20">
                        {i + 1}
                      </div>
                      <span className="font-extrabold text-slate-300 truncate text-sm pr-6 group-hover:text-white transition-colors">{p.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePlace(p); }}
                        className="absolute right-3 bg-red-900/50 text-red-300 hover:bg-red-600 hover:text-white w-7 h-7 rounded-lg font-black opacity-0 group-hover:opacity-100 transition-all shadow-sm flex items-center justify-center border border-red-500/50"
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
                className={`mt-6 w-full font-black py-4 rounded-[1.5rem] shadow-lg transition-all duration-300 text-base relative overflow-hidden group/gen border ${
                  canGenerate
                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:shadow-[0_0_15px_rgba(34,211,238,0.5)] hover:-translate-y-1 active:scale-95 border-cyan-400/50'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-70 border-white/10'
                }`}
              >
                {canGenerate && <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover/gen:translate-x-[100%] transition-transform duration-700 ease-in-out" />}
                ⚡ Generate {days}-Day Plan
              </button>
            </div>

            {/* Generated itinerary preview */}
            {itinerary && (
              <div className="glass-panel border-cyan-500/50 rounded-[2rem] shadow-[0_0_20px_rgba(34,211,238,0.15)] p-8 relative overflow-hidden animate-in slide-in-from-right-8 duration-500">
                <div className="absolute -top-10 -right-10 opacity-10 text-[150px] pointer-events-none drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">✨</div>
                <h3 className="text-xl font-black text-cyan-300 mb-6 flex items-center justify-between relative z-10">
                  <span className="flex items-center gap-2">✅ Optimized Plan</span>
                  <span className="text-xs bg-cyan-900/50 border border-cyan-500/50 text-cyan-100 px-3 py-1 rounded-full font-bold shadow-sm">
                    {days} day{days > 1 ? 's' : ''}
                  </span>
                </h3>
                <div className="flex flex-col gap-6 max-h-80 overflow-y-auto pr-2 custom-scrollbar relative z-10">
                  {itinerary.map(dayObj => (
                    <div key={dayObj.day} className="bg-slate-900/50 p-4 rounded-2xl border border-white/10">
                      <p className="text-xs font-black uppercase tracking-widest text-cyan-300 bg-slate-800 px-3 py-1.5 rounded-xl mb-3 border border-white/10 shadow-sm inline-block">
                        Day {dayObj.day}
                      </p>
                      <div className="flex flex-col gap-2 pl-1">
                        {dayObj.places.map((p, i) => (
                          <div key={p.id} className="text-sm font-bold text-slate-300 flex items-start gap-3 bg-slate-800/80 p-2.5 rounded-xl border border-white/5 shadow-sm">
                            <span className="text-cyan-300 font-black shrink-0 bg-slate-900 w-6 h-6 flex items-center justify-center rounded-md border border-cyan-500/30">{i + 1}</span>
                            <span className="mt-0.5">{p.name}</span>
                            {p.openingTime && (
                              <span className="text-[10px] text-slate-400 ml-auto shrink-0 mt-1 font-bold bg-slate-900 px-2 py-0.5 rounded">{p.openingTime}</span>
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
                  ? 'bg-emerald-900/50 border-emerald-500/50 text-emerald-300'
                  : 'bg-red-900/50 border-red-500/50 text-red-300'
              }`}>
                <span className="text-xl">{saveMsg.type === 'success' ? '🚀' : '⚠️'}</span> {saveMsg.text}
              </div>
            )}

            <button
              onClick={handleSaveTrip}
              disabled={!canSave || saving}
              className={`w-full font-black py-4.5 rounded-[1.5rem] shadow-xl text-lg transition-all duration-300 relative overflow-hidden group/save border ${
                canSave && !saving
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:shadow-[0_0_15px_rgba(16,185,129,0.5)] hover:-translate-y-1 active:scale-95 border-emerald-400/50'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-70 py-4 border-white/10'
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
        <div className="glass-panel p-8 md:p-12 rounded-[2rem] border border-white/10 relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
          <div className="absolute -top-10 -right-10 opacity-5 text-[200px] pointer-events-none rotate-12 select-none drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">🗄️</div>
          <h2 className="text-3xl font-black text-white mb-8 tracking-tight relative z-10 flex items-center gap-4">
            <span className="bg-blue-900/50 text-blue-300 p-3 rounded-2xl shadow-sm border border-blue-500/30">📂</span>
            My Saved Trips
          </h2>

          {loadingTrips ? (
            <div className="flex items-center justify-center py-20 gap-6">
              <div className="relative flex justify-center items-center">
                <div className="w-16 h-16 border-4 border-cyan-500/30 rounded-full" />
                <div className="w-16 h-16 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
              </div>
              <p className="text-slate-400 font-extrabold tracking-wide uppercase animate-pulse">Loading trips...</p>
            </div>
          ) : savedTrips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 bg-slate-900/30 rounded-[2rem] border-2 border-dashed border-white/10 gap-5">
              <span className="text-6xl opacity-30 animate-bounce">📂</span>
              <p className="text-slate-500 font-black text-xl text-center">No trips saved yet. Plan and save your first trip!</p>
              <button
                onClick={() => setTab('plan')}
                className="mt-4 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-black px-8 py-4 rounded-xl shadow-lg hover:shadow-[0_0_15px_rgba(34,211,238,0.3)] hover:-translate-y-1 active:scale-95 transition-all duration-300 border border-cyan-400/50"
              >
                Start Planning
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
              {savedTrips.map(trip => (
                <div key={trip.id} className="border border-white/10 rounded-2xl overflow-hidden shadow hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-all duration-300 bg-slate-900/50 hover:-translate-y-1 flex flex-col hover:border-cyan-500/30">
                  {/* Card header */}
                  <div className="bg-slate-800/80 p-5 border-b border-white/5 flex justify-between items-start">
                    <div>
                      <h3 className="font-extrabold text-2xl text-white flex items-center gap-2 tracking-tight">
                        <span className="bg-cyan-500 w-3 h-3 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                        {trip.city}
                      </h3>
                      <div className="flex gap-2 mt-2">
                        <span className="text-xs font-bold bg-cyan-900/50 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                          {trip.days || 1} day{(trip.days || 1) > 1 ? 's' : ''}
                        </span>
                        <span className="text-xs font-bold bg-slate-700 text-slate-300 border border-white/10 px-2 py-0.5 rounded-full">
                          {trip.places?.length || 0} stops
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteTrip(trip.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors font-bold text-lg leading-none p-1"
                      title="Delete trip"
                    >
                      🗑
                    </button>
                  </div>

                  {/* Places timeline */}
                  <div className="p-5 flex-grow">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">
                      {new Date(trip.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>

                    {/* Day-based or flat list */}
                    {trip.itinerary ? (
                      <div className="flex flex-col gap-3">
                        {trip.itinerary.map(d => (
                          <div key={d.day}>
                            <p className="text-[10px] font-black uppercase tracking-wider text-cyan-400 mb-1.5">Day {d.day}</p>
                            <div className="border-l-2 border-white/10 pl-3 flex flex-col gap-1">
                              {d.places.map((p, i) => (
                                <p key={i} className="text-sm font-bold text-slate-300 truncate">
                                  <span className="text-cyan-600 mr-1">{i + 1}.</span>{p.name}
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="border-l-2 border-white/10 pl-4 flex flex-col gap-2">
                        {trip.places?.map((p, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <div className="bg-slate-900 border border-cyan-500/50 text-cyan-400 font-black text-[10px] w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5">
                              {i + 1}
                            </div>
                            <div>
                              <p className="font-extrabold text-white text-sm leading-tight truncate">{p.name}</p>
                              {p.description && (
                                <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{p.description}</p>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setDetailsModal(null)}>
          <div className="glass-panel border-cyan-500/30 rounded-[2rem] shadow-[0_0_50px_rgba(0,0,0,0.8)] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden relative animate-in zoom-in-95 slide-in-from-bottom-10 duration-500" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-900/80 backdrop-blur-sm shrink-0">
              <h3 className="text-2xl font-black text-white pr-8 line-clamp-1 flex items-center gap-3">
                <span className="bg-cyan-900/50 text-cyan-300 p-2 rounded-xl shadow-sm border border-cyan-500/30 text-base">📌</span>
                {detailsModal.name}
              </h3>
              <button 
                onClick={() => setDetailsModal(null)} 
                className="text-slate-400 hover:text-white hover:bg-red-900/80 hover:border-red-500/50 border border-transparent font-black bg-slate-800/80 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 transform hover:rotate-90 active:scale-95"
                title="Close"
              >✕</button>
            </div>

            {/* Body */}
            <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar text-slate-200">
              {detailsLoading ? (
                <div className="py-20 flex flex-col items-center justify-center text-slate-500 font-black gap-6">
                  <div className="relative flex justify-center items-center">
                    <div className="w-16 h-16 border-4 border-cyan-500/30 rounded-full" />
                    <div className="w-16 h-16 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
                  </div>
                  Loading destination intel...
                </div>
              ) : detailsData ? (
                <div className="flex flex-col gap-8">
                  {/* Image */}
                  {detailsData.image ? (
                    <div className="relative w-full h-72 rounded-[1.5rem] shadow-lg overflow-hidden group border border-white/10">
                      <img src={detailsData.image} alt={detailsData.name} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    </div>
                  ) : (
                    <div className="w-full h-56 bg-slate-900/50 rounded-[1.5rem] border-2 border-dashed border-white/10 flex flex-col items-center justify-center text-slate-600 font-black gap-3 transition-colors hover:bg-slate-800/50 hover:border-white/20">
                      <span className="text-5xl opacity-40">📷</span>
                      No Image Available
                    </div>
                  )}
                  
                  {/* Description */}
                  <div className="bg-slate-900/50 p-6 rounded-[1.5rem] border border-white/10">
                    <h4 className="text-xs font-black text-cyan-400 uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-white/10 pb-3">
                      <span className="bg-cyan-900/50 p-1.5 rounded-lg border border-cyan-500/30">ℹ️</span> About this Location
                    </h4>
                    <p className="text-slate-300 leading-relaxed text-sm whitespace-pre-wrap font-medium">
                      {detailsData.description === "Details not available" && detailsModal.description 
                        ? detailsModal.description 
                        : detailsData.description}
                    </p>
                  </div>

                  {/* Add to Trip Action */}
                  <button
                    onClick={() => { togglePlace(detailsModal); setDetailsModal(null); }}
                    className={`w-full py-4.5 font-black rounded-[1.5rem] shadow-xl text-lg transition-all duration-300 hover:-translate-y-1 active:scale-95 border ${selectedPlaces.some(p => p.id === detailsModal.id) ? 'bg-red-900/30 border-red-500/50 text-red-300 hover:bg-red-800/80 hover:text-white' : 'bg-gradient-to-r from-cyan-600 to-blue-600 border-cyan-400/50 text-white shadow-[0_0_15px_rgba(34,211,238,0.3)]'}`}
                  >
                    {selectedPlaces.some(p => p.id === detailsModal.id) ? '🚫 Remove from Itinerary' : '✨ Add to Itinerary'}
                  </button>

                  {/* Nearby Places */}
                  {nearbyPlaces.length > 0 ? (
                    <div className="mt-4">
                      <h4 className="text-xs font-black text-cyan-400 uppercase tracking-widest mb-4">Nearby Places</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {nearbyPlaces.map((np, i) => (
                          <div 
                            key={i} 
                            onClick={() => handleOpenDetails({ name: np.name, id: np.id, latitude: np.latitude, longitude: np.longitude, description: np.snippet })}
                            className="bg-slate-800/50 border border-white/5 p-4 rounded-xl shadow-sm hover:border-cyan-500/50 transition-colors cursor-pointer"
                          >
                            <span className="font-bold text-white block truncate text-sm mb-1">{np.name}</span>
                            <span className="text-xs text-slate-400 line-clamp-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: np.snippet }}></span>
                            {np.distance && <span className="block mt-2 text-xs font-black text-cyan-500">📍 {np.distance} km away</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 text-sm font-bold text-slate-500">No nearby places</div>
                  )}

                  {/* Nearby Services */}
                  {nearbyServices.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-black text-cyan-400 uppercase tracking-widest mb-4">Essential Services Nearby</h4>
                      <div className="flex flex-col gap-3">
                        {['restaurant', 'hotel', 'hospital', 'atm', 'police'].map((cat) => {
                          const items = nearbyServices.filter(s => s.type === cat || (cat === 'hotel' && s.type === 'guest_house'));
                          if (items.length === 0) return null;
                          const icon = cat === 'restaurant' ? '🍽️' : cat === 'hotel' ? '🏨' : cat === 'hospital' ? '🏥' : cat === 'atm' ? '💳' : '🚓';
                          const catName = cat === 'hospital' || cat === 'restaurant' ? cat + 's' : (cat === 'police' ? 'Police' : cat.toUpperCase());
                          
                          return (
                            <div key={cat} className="bg-slate-800/50 border border-white/5 p-4 rounded-xl">
                              <h5 className="font-extrabold text-white text-sm mb-2 capitalize flex items-center gap-2">{icon} {catName}</h5>
                              <div className="flex flex-col gap-2">
                                {items.slice(0, 5).map((s, idx) => (
                                  <div key={idx} className="flex justify-between items-center text-sm">
                                    <span className="font-bold text-slate-300 truncate pr-2">{s.name}</span>
                                    <span className="text-xs font-black text-cyan-400 shrink-0 bg-slate-900 border border-white/10 px-2 py-0.5 rounded">{s.distance} km</span>
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
                <div className="py-12 text-center font-bold text-slate-500 border-2 border-dashed border-white/10 rounded-2xl">Details not available</div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TripPlanner;

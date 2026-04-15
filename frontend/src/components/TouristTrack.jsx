import React, { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// ── Fix Leaflet default icon broken paths in React/Vite ─────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Orange icon for IP-fallback marker — visually distinct from GPS marker
const fallbackIcon = new L.Icon({
  iconUrl:       'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize:      [25, 41],
  iconAnchor:    [12, 41],
  popupAnchor:   [1, -34],
  shadowSize:    [41, 41],
});

// Smoothly re-centres map when lat/lng change
const DynamicMapCenter = ({ lat, lng }) => {
  const map = useMap();
  useEffect(() => {
    if (lat !== null && lng !== null) {
      map.flyTo([lat, lng], 15, { animate: true, duration: 1.2 });
    }
  }, [lat, lng, map]);
  return null;
};

// Hard geographic centre of India — used only before ANY location resolves
const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

// ─────────────────────────────────────────────────────────────────────────────
const TouristTrack = () => {
  const [latitude,    setLatitude]    = useState(null);
  const [longitude,   setLongitude]   = useState(null);
  const [locSource,   setLocSource]   = useState(''); // 'gps' | 'ip' | ''
  const [tracking,    setTracking]    = useState(false);
  const [shortCode,   setShortCode]   = useState('');
  const [geoError,    setGeoError]    = useState('');
  const [status,      setStatus]      = useState('');
  const [ipFallbackUsed, setIpFallbackUsed] = useState(false);

  const watchIdRef      = useRef(null);
  const fallbackFiredRef = useRef(false); // prevent duplicate fallback calls

  // ── 1. Generate / load tourist short code ───────────────────────────────
  useEffect(() => {
    let isMounted = true;
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) return;
      try {
        const q    = query(collection(db, 'touristCodes'), where('userId', '==', user.uid));
        const snap = await getDocs(q);
        
        if (!isMounted) return;

        if (!snap.empty) {
          setShortCode(snap.docs[0].data().code);
        } else {
          // Generate a unique 6-character alphanumeric code
          let isUnique = false;
          let newCode = '';
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded confusing chars like I, 1, O, 0
          
          while (!isUnique) {
            newCode = 'TR';
            for (let i = 0; i < 4; i++) {
              newCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            
            // Check collision
            const codeQuery = query(collection(db, 'touristCodes'), where('code', '==', newCode));
            const codeSnap = await getDocs(codeQuery);
            if (codeSnap.empty) {
              isUnique = true;
            }
          }

          await setDoc(doc(db, 'touristCodes', newCode), { code: newCode, userId: user.uid });
          if (isMounted) setShortCode(newCode);
        }
      } catch (err) {
        console.error('[TouristTrack] Code setup error:', err);
      }
    });
    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  // ── 2. Push coordinates to Firestore ─────────────────────────────────────
  const pushToFirestore = useCallback(async (lat, lng, source) => {
    const user = auth.currentUser;
    if (!user) {
      console.warn('[TouristTrack] Not authenticated — skipping Firestore write.');
      return;
    }
    const payload = {
      userId:    user.uid,
      latitude:  lat,
      longitude: lng,
      source,                // 'gps' or 'ip' — useful for debugging
      timestamp: Date.now(),
    };
    console.log('[TouristTrack] Writing to Firestore:', payload);
    try {
      await setDoc(doc(db, 'locations', user.uid), payload, { merge: true });
      setStatus(`✅ ${source === 'gps' ? 'GPS' : 'IP-based'} location synced at ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      console.error('[TouristTrack] Firestore write failed:', e);
      setStatus('⚠️ Firestore sync failed — check console.');
    }
  }, []);

  // ── 3. IP-based fallback location ────────────────────────────────────────
  const fetchIPFallback = useCallback(async () => {
    if (fallbackFiredRef.current) return; // only run once per tracking session
    fallbackFiredRef.current = true;

    console.log('[TouristTrack] GPS failed — attempting IP-based fallback...');
    setStatus('🌐 GPS unavailable — attempting IP-based location...');

    try {
      const res  = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(8000) });
      const data = await res.json();

      if (data && data.latitude && data.longitude) {
        const lat = parseFloat(data.latitude);
        const lng = parseFloat(data.longitude);
        console.log(`[TouristTrack] IP fallback resolved → lat: ${lat}, lng: ${lng} (${data.city}, ${data.country_name})`);

        setLatitude(lat);
        setLongitude(lng);
        setLocSource('ip');
        setIpFallbackUsed(true);
        setGeoError('GPS unavailable — showing approximate IP-based location.');
        setStatus(`🌐 Showing approximate location: ${data.city || ''}, ${data.region || ''}`);

        // Still write to Firestore so parent can track approximate location
        pushToFirestore(lat, lng, 'ip');
      } else {
        console.warn('[TouristTrack] IP API returned no coordinates:', data);
        setGeoError('Unable to determine location. Check GPS and network.');
        setStatus('');
      }
    } catch (err) {
      console.error('[TouristTrack] IP fallback fetch failed:', err);
      setGeoError('GPS and IP-based location both failed. Check your network.');
      setStatus('');
    }
  }, [pushToFirestore]);

  // ── 4. watchPosition success ─────────────────────────────────────────────
  const onPositionSuccess = useCallback((pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    console.log(`[TouristTrack] GPS success → lat: ${lat}, lng: ${lng}, accuracy: ${pos.coords.accuracy}m`);

    fallbackFiredRef.current = false; // reset so fallback can fire again if GPS drops
    setGeoError('');
    setIpFallbackUsed(false);
    setLatitude(lat);
    setLongitude(lng);
    setLocSource('gps');
    pushToFirestore(lat, lng, 'gps');
  }, [pushToFirestore]);

  // ── 5. watchPosition error ───────────────────────────────────────────────
  const onPositionError = useCallback((err) => {
    console.error('[TouristTrack] Geolocation error — code:', err.code, '| message:', err.message);

    if (err.code === 1) {
      // PERMISSION_DENIED — user explicitly blocked
      console.error('[TouristTrack] Permission denied by user.');
      setGeoError('Location permission denied. Please enable location in your browser settings.');
      alert('⚠️ Location access is required to broadcast your position. Please allow it in your browser settings and try again.');
      setTracking(false);

    } else if (err.code === 2) {
      // POSITION_UNAVAILABLE — GPS hardware / signal issue
      console.warn('[TouristTrack] Position unavailable — triggering IP fallback.');
      setGeoError('GPS signal unavailable — trying IP-based location...');
      fetchIPFallback();

    } else if (err.code === 3) {
      // TIMEOUT
      console.warn('[TouristTrack] Geolocation timeout — triggering IP fallback.');
      setGeoError('GPS timed out — trying IP-based location...');
      fetchIPFallback();
    }
  }, [fetchIPFallback]);

  // ── 6. Start / stop watchPosition when tracking toggles ──────────────────
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation is not supported by your browser.');
      fetchIPFallback(); // still try IP even without native GPS API
      return;
    }

    if (tracking) {
      fallbackFiredRef.current = false; // reset per session
      setStatus('📡 Acquiring GPS signal...');
      console.log('[TouristTrack] Starting watchPosition...');

      watchIdRef.current = navigator.geolocation.watchPosition(
        onPositionSuccess,
        onPositionError,
        {
          enableHighAccuracy: true,
          timeout:            15000,
          maximumAge:         0,    // always fresh, never cached
        }
      );
      console.log('[TouristTrack] watchPosition started — watchId:', watchIdRef.current);

    } else {
      // Stop watching
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        console.log('[TouristTrack] watchPosition stopped — watchId:', watchIdRef.current);
        watchIdRef.current = null;
      }
      setStatus('');
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [tracking, onPositionSuccess, onPositionError, fetchIPFallback]);

  // ── Map centre / zoom ────────────────────────────────────────────────────
  const hasCoords  = latitude !== null && longitude !== null;
  const mapCenter  = hasCoords ? [latitude, longitude] : [INDIA_CENTER.lat, INDIA_CENTER.lng];
  const mapZoom    = hasCoords ? 15 : 5;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-8">

      {/* ── Header card ── */}
      <div className="bg-white p-8 rounded-3xl shadow-xl border border-blue-50 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-center md:text-left">
          <h2 className="text-4xl font-black text-blue-900 tracking-tight mb-2">
            Location Broadcasting
          </h2>
          <p className="text-gray-500 font-bold text-lg">
            Transmit your real-time GPS coordinates to your guardian.
          </p>

          {/* Tracker code */}
          {shortCode ? (
            <div className="mt-5 bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 px-6 py-4 rounded-2xl flex flex-col gap-1 shadow-inner">
              <span className="text-[11px] font-black text-yellow-700 uppercase tracking-widest">
                Share this code with your Guardian
              </span>
              <span className="font-mono text-4xl text-yellow-800 font-black select-all tracking-[0.2em]">
                {shortCode}
              </span>
            </div>
          ) : (
            <div className="mt-5 text-blue-400 font-bold animate-pulse text-sm">
              Generating tracker code...
            </div>
          )}

          {/* Live coords readout */}
          {hasCoords && (
            <div className={`mt-4 px-4 py-2 rounded-xl text-sm font-mono font-bold flex items-center gap-2 border ${
              locSource === 'gps'
                ? 'bg-blue-50 border-blue-100 text-blue-800'
                : 'bg-orange-50 border-orange-200 text-orange-800'
            }`}>
              {locSource === 'gps' ? '🛰️ GPS' : '🌐 IP'}&nbsp;
              {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </div>
          )}
        </div>

        {/* Start / Stop */}
        <button
          onClick={() => setTracking(prev => !prev)}
          className={`px-10 py-5 rounded-2xl font-black text-xl shadow-xl transition-all transform hover:scale-105 text-white min-w-[250px] ${
            tracking
              ? 'bg-red-500 hover:bg-red-600 animate-pulse border-4 border-red-200'
              : 'bg-blue-600 hover:bg-blue-700 border-4 border-blue-200'
          }`}
        >
          {tracking ? '🛑 Stop Broadcasting' : '📡 Start Broadcasting'}
        </button>
      </div>

      {/* ── Error banner (yellow for IP fallback, red for hard errors) ── */}
      {geoError && (
        <div className={`w-full font-bold text-sm px-5 py-3 rounded-2xl flex items-center gap-3 border ${
          ipFallbackUsed
            ? 'bg-orange-50 border-orange-200 text-orange-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <span className="text-xl">{ipFallbackUsed ? '🌐' : '⚠️'}</span> {geoError}
        </div>
      )}

      {/* ── Status line ── */}
      {status && !geoError && (
        <div className="w-full bg-blue-50 border border-blue-200 text-blue-700 font-bold text-sm px-5 py-2 rounded-2xl">
          {status}
        </div>
      )}

      {/* ── Map ── */}
      <div className="w-full bg-white p-4 rounded-3xl border border-gray-200 shadow-xl overflow-hidden relative z-0 h-[650px]">
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          style={{ height: '100%', width: '100%' }}
          className="rounded-2xl"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Smooth re-centre on every coord update */}
          {hasCoords && <DynamicMapCenter lat={latitude} lng={longitude} />}

          {/* Marker — key={} forces a full re-render when coords change */}
          {hasCoords && (
            <Marker
              key={`${latitude.toFixed(5)}-${longitude.toFixed(5)}`}
              position={[latitude, longitude]}
              icon={locSource === 'ip' ? fallbackIcon : new L.Icon.Default()}
            >
              <Popup>
                {locSource === 'gps' ? (
                  <>
                    <strong className="text-blue-900 font-extrabold text-base block">📍 You are here!</strong>
                    <span className="text-xs text-gray-500 font-bold block mt-1">
                      {latitude.toFixed(6)}, {longitude.toFixed(6)}
                    </span>
                    <span className="text-xs text-gray-400 block">GPS · {new Date().toLocaleTimeString()}</span>
                  </>
                ) : (
                  <>
                    <strong className="text-orange-700 font-extrabold text-base block">🌐 Approximate Location</strong>
                    <span className="text-xs text-gray-500 font-bold block mt-1">
                      {latitude.toFixed(6)}, {longitude.toFixed(6)}
                    </span>
                    <span className="text-xs text-orange-500 block">IP-based — may not be exact</span>
                  </>
                )}
              </Popup>
            </Marker>
          )}
        </MapContainer>

        {/* Overlay — shown only before ANY location resolves (GPS or IP) */}
        {!tracking && !hasCoords && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-[500] flex flex-col items-center justify-center rounded-2xl pointer-events-none">
            <span className="text-6xl mb-4 opacity-70">🌍</span>
            <h3 className="text-2xl font-black text-blue-900">GPS Broadcasting Offline</h3>
            <p className="font-bold text-gray-600 bg-white/90 px-4 py-2 mt-4 rounded-lg shadow-sm">
              Click 'Start Broadcasting' to share your live location.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TouristTrack;

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix Leaflet default icon broken paths in React/Vite builds
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom User Pulse Icon
const userPulseIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="position:relative; display:flex; justify-content:center; align-items:center;">
          <div style="position:absolute; width: 40px; height: 40px; background: rgba(59, 130, 246, 0.4); border-radius: 50%; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 20px; height: 20px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.4); z-index: 10;"></div>
         </div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// Helper for generating custom marker icons
const createCustomIcon = (type, category) => {
  let bgColor = '#64748b'; // default slate
  let emoji = '📍';
  let isGlowing = false;

  switch(category) {
    case 'Attractions':
      bgColor = '#8b5cf6'; // violet
      emoji = '✨';
      isGlowing = true;
      break;
    case 'Emergency':
      bgColor = '#ef4444'; // red
      emoji = type === 'Police Station' ? '👮' : '🏥';
      break;
    case 'Food & Stay':
      bgColor = '#f59e0b'; // amber
      emoji = type === 'Hotel/Lodge' ? '🏨' : '🍽️';
      break;
    case 'Transport':
      bgColor = '#3b82f6'; // blue
      emoji = '🚌';
      break;
    case 'Shopping':
      bgColor = '#ec4899'; // pink
      emoji = '🛍️';
      break;
  }

  const glowStyle = isGlowing ? `box-shadow: 0 0 15px ${bgColor}, 0 0 5px white; border: 2px solid white;` : `border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);`;
  const size = isGlowing ? 36 : 30;
  
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: ${bgColor}; width: ${size}px; height: ${size}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: ${size/2}px; ${glowStyle} transition: transform 0.2s;">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size],
    popupAnchor: [0, -size],
  });
};

// Component to smoothly fly to user location once fetched
const FlyToLocation = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, 14, { animate: true, duration: 1.5 });
    }
  }, [center, map]);
  return null;
};

const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const MapComponent = ({ onAttractionsFound, onLocationUpdate }) => {
  const [userCenter, setUserCenter] = useState(null);
  const [places, setPlaces] = useState([]);
  const [locationError, setLocationError] = useState('');
  const [isLocating, setIsLocating] = useState(true);
  
  const [filters, setFilters] = useState({
    Attractions: true,
    'Food & Stay': false,
    Emergency: false,
    Transport: false,
    Shopping: false
  });

  const watchIdRef = useRef(null);
  const centerRef = useRef(null);
  const fetchedLocationRef = useRef(false);

  // Get user's real GPS location in real-time
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported by your browser.');
      setIsLocating(false);
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        centerRef.current = [lat, lon];
        setUserCenter([lat, lon]);
        setLocationError('');
        setIsLocating(false);
        
        if (onLocationUpdate) onLocationUpdate(lat, lon);

        // Only fetch places once per major location change to avoid spamming API
        if (!fetchedLocationRef.current) {
          fetchedLocationRef.current = true;
          fetchOverpassData(lat, lon);
        }
      },
      (error) => {
        console.error("Geolocation error:", error);
        setLocationError('Could not get your location. Please enable GPS.');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const fetchOverpassData = async (lat, lon) => {
    try {
      const radius = 6000; // 6km search radius
      const query = `
        [out:json];
        (
          node["amenity"="hospital"](around:${radius},${lat},${lon});
          node["amenity"="police"](around:${radius},${lat},${lon});
          node["amenity"="pharmacy"](around:${radius},${lat},${lon});
          node["amenity"="restaurant"](around:${radius},${lat},${lon});
          node["amenity"="cafe"](around:${radius},${lat},${lon});
          node["tourism"="hotel"](around:${radius},${lat},${lon});
          node["tourism"="guest_house"](around:${radius},${lat},${lon});
          node["amenity"="bus_station"](around:${radius},${lat},${lon});
          node["railway"="station"](around:${radius},${lat},${lon});
          node["station"="subway"](around:${radius},${lat},${lon});
          node["aeroway"="aerodrome"](around:${radius},${lat},${lon});
          node["amenity"="taxi"](around:${radius},${lat},${lon});
          node["tourism"="attraction"](around:${radius},${lat},${lon});
          node["tourism"="museum"](around:${radius},${lat},${lon});
          node["historic"="monument"](around:${radius},${lat},${lon});
          node["historic"="fort"](around:${radius},${lat},${lon});
          node["amenity"="place_of_worship"](around:${radius},${lat},${lon});
          node["natural"="beach"](around:${radius},${lat},${lon});
          node["leisure"="park"](around:${radius},${lat},${lon});
          node["leisure"="garden"](around:${radius},${lat},${lon});
          node["tourism"="zoo"](around:${radius},${lat},${lon});
          node["shop"="mall"](around:${radius},${lat},${lon});
          node["shop"="supermarket"](around:${radius},${lat},${lon});
          node["amenity"="atm"](around:${radius},${lat},${lon});
        );
        out center;
      `;
      const res = await fetch(`https://overpass-api.de/api/interpreter`, {
        method: 'POST',
        body: query
      });
      const data = await res.json();
      
      const parsedPlaces = data.elements.map(el => {
        let type = 'Unknown';
        let category = 'Others';
        
        if (el.tags?.amenity === 'hospital') { type = 'Hospital'; category = 'Emergency'; }
        else if (el.tags?.amenity === 'police') { type = 'Police Station'; category = 'Emergency'; }
        else if (el.tags?.amenity === 'pharmacy') { type = 'Pharmacy'; category = 'Emergency'; }
        
        else if (el.tags?.amenity === 'restaurant') { type = 'Restaurant'; category = 'Food & Stay'; }
        else if (el.tags?.amenity === 'cafe') { type = 'Cafe'; category = 'Food & Stay'; }
        else if (el.tags?.tourism === 'hotel' || el.tags?.tourism === 'guest_house') { type = 'Hotel/Lodge'; category = 'Food & Stay'; }
        
        else if (el.tags?.amenity === 'bus_station' || el.tags?.railway === 'station' || el.tags?.station === 'subway' || el.tags?.aeroway === 'aerodrome' || el.tags?.amenity === 'taxi') { type = 'Transport'; category = 'Transport'; }
        
        else if (el.tags?.tourism === 'attraction' || el.tags?.tourism === 'museum' || el.tags?.historic || el.tags?.amenity === 'place_of_worship' || el.tags?.natural || el.tags?.leisure || el.tags?.tourism === 'zoo') { type = 'Attraction'; category = 'Attractions'; }
        
        else if (el.tags?.shop || el.tags?.amenity === 'atm' || el.tags?.amenity === 'fuel') { type = 'Shopping'; category = 'Shopping'; }

        return {
          id: el.id,
          name: el.tags?.name || `Unnamed ${type}`,
          type,
          category,
          lat: el.lat,
          lon: el.lon,
          address: el.tags?.['addr:street'] || el.tags?.['addr:city'] || '',
          phone: el.tags?.phone || '',
          distance: getDistance(lat, lon, el.lat, el.lon).toFixed(2)
        };
      }).filter(p => !p.name.startsWith('Unnamed'));

      setPlaces(parsedPlaces);
      
      if (onAttractionsFound) {
        const attractions = parsedPlaces.filter(p => p.category === 'Attractions').sort((a,b) => parseFloat(a.distance) - parseFloat(b.distance));
        onAttractionsFound(attractions);
      }
    } catch(err) {
      console.error('Overpass fetch error:', err);
    }
  };

  const toggleFilter = (cat) => {
    setFilters(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const displayedPlaces = places.filter(p => filters[p.category]);

  return (
    <div className="w-full flex flex-col gap-4">
      
      {/* Map Header & Filters */}
      <div className="bg-white/40 backdrop-blur-md border border-white/40 p-4 rounded-2xl shadow-sm flex flex-col gap-3 relative z-10">
        <h3 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
          🗺️ Smart Travel Map
          {isLocating && <span className="text-sm font-bold text-blue-600 bg-blue-100 px-3 py-1 rounded-full animate-pulse ml-2">Locating you...</span>}
        </h3>
        
        <div className="flex flex-wrap gap-2">
          {Object.keys(filters).map(cat => (
            <button 
              key={cat} 
              onClick={() => toggleFilter(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all border ${
                filters[cat] 
                  ? 'bg-slate-800 text-white border-slate-800 shadow-md transform scale-105' 
                  : 'bg-white/60 text-slate-500 border-white/50 hover:bg-white'
              }`}
            >
              {cat === 'Attractions' ? '✨' : cat === 'Food & Stay' ? '🍽️' : cat === 'Emergency' ? '🏥' : cat === 'Transport' ? '🚌' : '🛍️'} {cat}
            </button>
          ))}
        </div>
      </div>

      {locationError && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm font-bold px-4 py-3 rounded-xl flex items-center gap-2">
          <span>⚠️</span> {locationError}
        </div>
      )}

      {/* Map Container */}
      {userCenter && (
      <div style={{ height: '650px', width: '100%', borderRadius: '1rem', overflow: 'hidden', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} className="z-0 relative border-4 border-white/50">
        <MapContainer
          center={userCenter}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
        >
          {/* Light modern carto tile theme */}
          <TileLayer
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <FlyToLocation center={userCenter} />

          {/* User Location Marker with Pulse */}
          <Marker position={userCenter} icon={userPulseIcon} zIndexOffset={1000}>
              <Popup className="glass-popup">
                <div className="text-center font-black text-blue-700 p-1">
                  📍 You are here
                  <br />
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full mt-1 inline-block">
                    {userCenter[0].toFixed(5)}, {userCenter[1].toFixed(5)}
                  </span>
                </div>
              </Popup>
          </Marker>

          <MarkerClusterGroup 
            chunkedLoading 
            maxClusterRadius={40}
            disableClusteringAtZoom={16}
          >
            {displayedPlaces.map((place) => (
              <Marker
                key={place.id}
                position={[place.lat, place.lon]}
                icon={createCustomIcon(place.type, place.category)}
              >
                <Popup className="custom-modern-popup">
                  <div className="p-2 min-w-[220px]">
                    <h3 className="font-extrabold text-lg text-slate-800 mb-1 leading-tight">{place.name}</h3>
                    
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <span className={`inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded font-black ${
                        place.category === 'Attractions' ? 'bg-violet-100 text-violet-800' :
                        place.category === 'Emergency' ? 'bg-red-100 text-red-800' :
                        place.category === 'Food & Stay' ? 'bg-amber-100 text-amber-800' :
                        place.category === 'Transport' ? 'bg-blue-100 text-blue-800' :
                        'bg-pink-100 text-pink-800'
                      }`}>
                        {place.type}
                      </span>
                      <span className="inline-block bg-slate-100 text-slate-600 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded font-black">
                        {place.distance} km
                      </span>
                    </div>

                    {place.address && (
                      <div className="flex items-start gap-2 mb-2 text-xs font-semibold text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <span className="text-slate-400 mt-0.5">📍</span>
                        <p>{place.address}</p>
                      </div>
                    )}
                    
                    {place.phone && (
                      <p className="text-xs font-bold text-slate-600 flex items-center gap-2 mb-2">
                        <span className="bg-slate-100 p-1 rounded-full">📞</span> {place.phone}
                      </p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>

        </MapContainer>
      </div>
      )}
    </div>
  );
};

export default MapComponent;

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

// Fix Leaflet default icon broken paths in React/Vite builds
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Blue marker for user's own location
const userIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Component to smoothly fly to user location once fetched
const FlyToLocation = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, 15, { animate: true, duration: 1.5 });
    }
  }, [center, map]);
  return null;
};

const MapComponent = () => {
  const [userCenter, setUserCenter] = useState(null);
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [isLocating, setIsLocating] = useState(true);
  const watchIdRef = useRef(null);
  const centerRef = useRef(null);

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
        console.log("Live Location:", lat, lon);
        centerRef.current = [lat, lon];
        setUserCenter([lat, lon]);
        setLocationError('');
        setIsLocating(false);
      },
      (error) => {
        console.error("Geolocation error:", error);
        if (error.code === 1) {
          setLocationError('Permission denied. Enable location access');
        } else if (error.code === 2) {
          setLocationError('Location unavailable. Turn on GPS');
        } else if (error.code === 3) {
          setLocationError('Request timed out');
        } else {
          setLocationError('Could not get your location.');
        }
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    console.log("Tracking active:", watchIdRef.current);

    // Fallback timer if GPS takes too long
    const timeoutId = setTimeout(() => {
      if (!centerRef.current) {
        setLocationError("Unable to fetch location. Please enable GPS.");
        setIsLocating(false);
      }
    }, 5000);

    return () => {
      clearTimeout(timeoutId);
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Fetch places from Firestore
  useEffect(() => {
    const fetchPlaces = async () => {
      try {
        const snap = await getDocs(collection(db, 'places'));
        const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPlaces(list);
      } catch (err) {
        console.error('Error fetching places from Firestore:', err);
      }
    };
    fetchPlaces();
  }, []);

  return (
    <div className="w-full flex flex-col gap-3">
      {locationError && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2">
          <span>⚠️</span> {locationError}
        </div>
      )}
      {isLocating && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2 animate-pulse">
          <span>📡</span> Fetching your location...
        </div>
      )}
      {userCenter && (
      <div style={{ height: '600px', width: '100%', borderRadius: '0.75rem', overflow: 'hidden' }}>
        <MapContainer
          center={userCenter}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Fly to user's GPS location once resolved */}
          <FlyToLocation center={userCenter} />

          {/* User's own location marker */}
          <Marker key={`${userCenter[0]}-${userCenter[1]}`} position={userCenter} icon={userIcon}>
              <Popup>
                <div className="text-center font-bold text-blue-900">
                  📍 You are here
                  <br />
                  <span className="text-xs font-normal text-gray-500">
                    {userCenter[0].toFixed(5)}, {userCenter[1].toFixed(5)}
                  </span>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Dynamic places from Firestore */}
          {places.map((place) =>
            place.latitude && place.longitude ? (
              <Marker
                key={place.id}
                position={[place.latitude, place.longitude]}
                eventHandlers={{ click: () => setSelectedPlace(place) }}
              >
                <Popup>
                  <div className="p-1 min-w-[160px]">
                    <h3 className="font-bold text-base text-gray-900 mb-1">{place.name}</h3>
                    {place.type && (
                      <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded font-bold mb-1">
                        {place.type}
                      </span>
                    )}
                    {place.description && (
                      <p className="text-sm text-gray-600">{place.description}</p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ) : null
          )}
        </MapContainer>
      </div>
      )}
    </div>
  );
};

export default MapComponent;

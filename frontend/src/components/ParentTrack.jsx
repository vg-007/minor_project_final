import React, { useState, useEffect } from 'react';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix Leaflet's default icon paths in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Component to dynamically re-center map when coords update
const RecenterMap = ({ lat, lng }) => {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) {
      map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
    }
  }, [lat, lng, map]);
  return null;
};

const ParentTrack = () => {
  const [touristInput, setTouristInput] = useState('');
  const [location, setLocation] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);

  // Helper function to resolve 'TR1234' -> 'userID_string'
  const resolveCodeToUserId = async (codeStr) => {
    const q = query(collection(db, 'touristCodes'), where('code', '==', codeStr.trim().toUpperCase()));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data().userId;
  };

  useEffect(() => {
    let unsub = () => {};
    let isActive = true;

    const startLiveWatch = async () => {
      if (isLive && touristInput) {
        const resolvedUserId = await resolveCodeToUserId(touristInput);
        if (!resolvedUserId && isActive) {
          setError('Invalid Tracker Alias Code.');
          setIsLive(false);
          return;
        }
        if (!isActive) return;

        const docRef = doc(db, 'locations', resolvedUserId);
        unsub = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setLocation({ lat: data.latitude, lng: data.longitude });
            setLastUpdated(new Date(data.timestamp).toLocaleString());
            setError('');
          } else {
            setError('Target is completely offline or location not active.');
          }
        }, (err) => {
          setError('Connection dropped to Firestore.');
          console.error(err);
        });
      }
    };

    startLiveWatch();
    return () => { isActive = false; unsub(); };
  }, [isLive, touristInput]);

  const handleManualSearch = async () => {
    if (!touristInput) return setError("Please input a Tracker Code (e.g., TR1234).");
    setIsLive(false);
    setError('');
    
    try {
      const resolvedUserId = await resolveCodeToUserId(touristInput);
      if (!resolvedUserId) return setError('Registry completely empty. Invalid Tracker Alias Code.');

      const docRef = doc(db, 'locations', resolvedUserId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        setLocation({ lat: data.latitude, lng: data.longitude });
        setLastUpdated(new Date(data.timestamp).toLocaleString());
      } else {
        setError('Target resolve successful, but no location data pinged yet.');
        setLocation(null);
      }
    } catch (e) {
      console.error(e);
      setError('Matrix resolution failed.');
    }
  };

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-6">
      <div className="bg-white p-8 rounded-2xl shadow-md border border-gray-100 flex flex-col items-center text-center">
        <h2 className="text-3xl font-extrabold text-blue-900 mb-2 tracking-tight">Guardian Tracking Matrix</h2>
        <p className="text-gray-500 font-bold mb-8">Enter the 6-Digit Tracker Alias (e.g., TR1234) to lock onto your family member's coordinates.</p>
        
        <div className="flex w-full max-w-2xl gap-3 flex-col sm:flex-row">
          <input 
             type="text" 
             value={touristInput} 
             onChange={e => { setTouristInput(e.target.value.toUpperCase()); setIsLive(false); }} 
             placeholder="Enter Alias (e.g. TR9982)" 
             className="flex-1 px-5 py-4 rounded-xl border border-gray-300 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none shadow-inner font-mono text-gray-800 font-extrabold text-xl tracking-widest uppercase" 
          />
          <div className="flex gap-2">
            <button 
               onClick={handleManualSearch}
               className="bg-gray-800 text-white font-bold px-6 py-4 rounded-xl shadow-md hover:bg-gray-900 transition flex-1"
            >
               Locate Once
            </button>
            <button 
               onClick={() => { if(touristInput) setIsLive(true); else setError("Please enter an Alias."); }}
               className={`text-white font-bold px-6 py-4 rounded-xl shadow-md transition flex-1 ${isLive ? 'bg-red-500 animate-pulse' : 'bg-green-600 hover:bg-green-700'}`}
            >
               {isLive ? '🔴 Live Mode Active' : '🟢 Start Live Watch'}
            </button>
          </div>
        </div>
        
        {error && <p className="text-red-500 mt-5 font-bold uppercase tracking-widest text-sm bg-red-50 px-4 py-2 rounded-lg border border-red-100">{error}</p>}
        {lastUpdated && <p className="text-blue-800 mt-5 font-bold bg-blue-50 px-4 py-2 rounded-lg border border-blue-100 text-sm tracking-wide">Last Packet Received: {lastUpdated}</p>}
      </div>

      <div className="w-full bg-white p-3 rounded-2xl border border-gray-200 shadow-md overflow-hidden relative z-0">
        {location ? (
          <MapContainer center={[location.lat, location.lng]} zoom={16} style={{ height: '600px', width: '100%' }} className="rounded-xl">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[location.lat, location.lng]}>
              <Popup>
                <div className="font-bold text-blue-900 text-center">
                  Target Acquired
                </div>
              </Popup>
            </Marker>
            <RecenterMap lat={location.lat} lng={location.lng} />
          </MapContainer>
        ) : (
          <div className="h-[600px] flex items-center justify-center text-gray-400 font-bold bg-gray-50 rounded-xl border border-dashed border-gray-300">
            Map projection bounds will centralize here upon successful Code lock.
          </div>
        )}
      </div>
    </div>
  );
};
export default ParentTrack;

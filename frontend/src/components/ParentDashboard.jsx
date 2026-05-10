import React, { useState, useEffect } from 'react';
import RoleHeader from './RoleHeader';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { motion } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const guideIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const RecenterMap = ({ touristLoc, guideLoc }) => {
  const map = useMap();
  useEffect(() => {
    if (touristLoc && guideLoc) {
      const bounds = L.latLngBounds(
        [touristLoc.lat, touristLoc.lng],
        [guideLoc.lat, guideLoc.lng]
      );
      map.flyToBounds(bounds, { padding: [50, 50], animate: true, duration: 1.5 });
    } else if (touristLoc) {
      map.flyTo([touristLoc.lat, touristLoc.lng], 16, { animate: true, duration: 1 });
    } else if (guideLoc) {
      map.flyTo([guideLoc.lat, guideLoc.lng], 16, { animate: true, duration: 1 });
    }
  }, [touristLoc, guideLoc, map]);
  return null;
};

const ParentDashboard = () => {
  const [touristInput, setTouristInput] = useState('');
  const [resolvedUserId, setResolvedUserId] = useState(null);
  const [location, setLocation] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);
  
  const [tripData, setTripData] = useState(null);
  const [guideData, setGuideData] = useState(null);
  
  const [guideId, setGuideId] = useState(null);
  const [guideLocation, setGuideLocation] = useState(null);
  const [guideLastUpdated, setGuideLastUpdated] = useState('');

  const resolveCodeToUserId = async (codeStr) => {
    const q = query(collection(db, 'touristCodes'), where('code', '==', codeStr.trim().toUpperCase()));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data().userId;
  };

  const fetchExtraData = async (uid) => {
     try {
       const tripsQ = query(collection(db, 'trips'), where('userId', '==', uid));
       const tripsSnap = await getDocs(tripsQ);
       if (!tripsSnap.empty) {
          const tripsList = tripsSnap.docs.map(t => t.data());
          tripsList.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
          setTripData(tripsList[0]);
       } else {
          setTripData(null);
       }
     } catch(e) { console.error("Trips fetch:", e) }

     try {
        const bookingsQ = query(collection(db, 'bookings'), where('touristId', '==', uid), where('status', '==', 'accepted'));
        const bookingsSnap = await getDocs(bookingsQ);
        if (!bookingsSnap.empty) {
           const bList = bookingsSnap.docs.map(b => b.data());
           bList.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
           const latestBooking = bList[0];
           
           const gSnap = await getDoc(doc(db, 'guides', latestBooking.guideId));
           if(gSnap.exists()) {
              const gData = gSnap.data();
              setGuideData({
                 name: latestBooking.guideName || gData.name,
                 phone: gData.phone || gData.contact || 'Not provided',
                 experience: gData.experience || 'N/A'
              });
              setGuideId(latestBooking.guideId);
           } else {
              setGuideData({ name: latestBooking.guideName, phone: 'N/A', experience: 'N/A' });
              setGuideId(latestBooking.guideId);
           }
        } else {
           setGuideData(null);
           setGuideId(null);
        }
     } catch(e){ console.error("Bookings fetch:", e) }
  };

  const executeLock = async () => {
    if (!touristInput) return setError("Please input a Tracker Code.");
    setError('');
    
    try {
      const uid = await resolveCodeToUserId(touristInput);
      if (!uid) return setError('Invalid Tracker Alias Code.');
      
      setResolvedUserId(uid);
      setIsLive(true);
      await fetchExtraData(uid);
      
    } catch (e) {
      console.error(e);
      setError('Matrix resolution failed.');
    }
  };

  useEffect(() => {
    let unsubTourist = () => {};
    let unsubGuide = () => {};

    if (isLive && resolvedUserId) {
        // Tourist Tracking Subscription
        unsubTourist = onSnapshot(doc(db, 'locations', resolvedUserId), (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            console.log("Tourist live location:", data);
            let formattedTime = '';
            if (data.timestamp) {
              const d = new Date(data.timestamp);
              formattedTime = isNaN(d.getTime()) ? String(data.timestamp) : d.toLocaleString();
            }
            setLocation({ lat: data.latitude, lng: data.longitude });
            setLastUpdated(formattedTime);
            setError('');
          } else {
            console.warn('[ParentDashboard] No location document for tourist');
          }
        }, (err) => setError('Live connection dropped. Check your network.'));

        // Guide Tracking Subscription (if guide is assigned and active)
        if (guideId) {
            unsubGuide = onSnapshot(doc(db, 'locations', guideId), (docSnap) => {
               if (docSnap.exists()) {
                 const data = docSnap.data();
                 console.log("Guide live location:", data);
                 let formattedTime = '';
                 if (data.timestamp) {
                   const d = new Date(data.timestamp);
                   formattedTime = isNaN(d.getTime()) ? String(data.timestamp) : d.toLocaleString();
                 }
                 setGuideLocation({ lat: data.latitude, lng: data.longitude });
                 setGuideLastUpdated(formattedTime);
               } else {
                 setGuideLocation(null);
               }
            }, (err) => console.error("Guide tracking error:", err));
        }
    }
    return () => { unsubTourist(); unsubGuide(); };
  }, [isLive, resolvedUserId, guideId]);

  return (
    <div className="max-w-7xl w-full mx-auto flex flex-col gap-6 text-slate-200">
      <RoleHeader role="parent" />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-6 md:p-8 rounded-3xl flex flex-col items-center text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-emerald-500/5 blur-3xl rounded-full"></div>
        <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight relative z-10">Parent Dashboard</h2>
        <p className="text-slate-400 font-bold mb-6 text-sm relative z-10">Enter the 6-Digit Tracker Alias (e.g., TR1234) for live metrics.</p>
        
        <div className="flex w-full max-w-xl gap-3 flex-col sm:flex-row relative z-10">
          <input 
             type="text" 
             value={touristInput} 
             onChange={e => { setTouristInput(e.target.value.toUpperCase()); setIsLive(false); setResolvedUserId(null); }} 
             placeholder="Enter Code" 
             className="glass-input flex-1 px-5 py-4 rounded-xl font-mono text-xl tracking-widest uppercase text-center" 
          />
          <button 
             onClick={executeLock}
             className="bg-emerald-600/80 backdrop-blur-md text-white font-extrabold px-8 py-4 rounded-xl shadow-md hover:bg-emerald-500 border border-emerald-400/50 transition"
          >
             Lock Target
          </button>
        </div>
        
        {error && <p className="text-red-400 mt-5 font-bold uppercase tracking-widest text-sm bg-red-900/50 px-5 py-2 rounded-xl border border-red-500/50 relative z-10">{error}</p>}
      </motion.div>

      {resolvedUserId && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Map Content */}
          <div className="lg:col-span-2 glass-panel p-3 rounded-3xl overflow-hidden relative z-0 flex flex-col min-h-[500px]">
            <div className="px-4 py-3 border-b border-white/10 flex justify-between items-center bg-slate-900/50 mb-2 rounded-t-2xl">
               <h3 className="font-black text-white flex items-center gap-2">
                 <span className="animate-pulse text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]">🔴</span> Live GPS Feed
               </h3>
               <div className="flex flex-col items-end gap-1">
                 {lastUpdated && (
                   <span className="text-xs font-black text-slate-400 tracking-tight bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                     Updated: {lastUpdated}
                   </span>
                 )}
                 {location && (
                   <span className="text-xs font-mono text-emerald-400 bg-emerald-900/30 px-3 py-1 rounded-lg border border-emerald-500/30 font-bold">
                     📍 {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                   </span>
                 )}
               </div>
            </div>
            
            {/* Map is always mounted to avoid remount flicker on location updates */}
            <div className={`relative flex-grow rounded-2xl overflow-hidden border border-white/5 bg-slate-950 ${!location ? 'h-[500px]' : ''}`} style={{ height: '500px' }}>
              <MapContainer
                center={location ? [location.lat, location.lng] : [17.3850, 78.4867]}
                zoom={location ? 16 : 5}
                style={{ height: '100%', width: '100%' }}
                className="rounded-2xl z-0"
              >
                <TileLayer
                  className="map-tiles-dark"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {location && (
                  <Marker position={[location.lat, location.lng]}>
                    <Popup>
                      <div className="font-bold text-emerald-900 text-center">
                        📍 Tourist Live Location<br/>
                        <span className="text-xs font-normal text-gray-500">{lastUpdated}</span>
                      </div>
                    </Popup>
                  </Marker>
                )}
                {guideLocation && (
                  <Marker position={[guideLocation.lat, guideLocation.lng]} icon={guideIcon}>
                    <Popup>
                      <div className="font-bold text-yellow-700 text-center">
                        🧑‍💼 Guide: {guideData?.name || 'Guide'}<br/>
                        <span className="text-xs font-normal text-gray-500">{guideLastUpdated}</span>
                      </div>
                    </Popup>
                  </Marker>
                )}
                {(location || guideLocation) && (
                  <RecenterMap touristLoc={location} guideLoc={guideLocation} />
                )}
              </MapContainer>
              {!location && (
                <div className="absolute inset-0 flex items-center justify-center text-slate-500 font-bold bg-slate-900/50 backdrop-blur-sm border-2 border-dashed border-white/10 z-10">
                  Awaiting active GPS coordinates...
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="glass-panel p-6 rounded-3xl">
              <h3 className="text-lg font-black text-white mb-4 border-b border-white/10 pb-3 flex items-center gap-2">🗺️ Tourist Itinerary</h3>
              {tripData ? (
                <div>
                   <p className="font-bold text-sm text-indigo-300 mb-3 bg-indigo-900/30 px-3 py-2 border border-indigo-500/30 rounded-xl inline-block tracking-tight">
                     📍 Route: {tripData.city} {tripData.days && <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full ml-1">{tripData.days} Days</span>}
                   </p>
                   
                   {tripData.itinerary ? (
                     <div className="space-y-3">
                       {tripData.itinerary.map((day, dIdx) => (
                         <div key={dIdx}>
                           <p className="text-[10px] font-black uppercase tracking-wider text-indigo-400 mb-1">Day {day.day}</p>
                           <ul className="list-disc list-inside text-xs font-bold text-slate-300 ml-2">
                             {day.places.map((p, pIdx) => (
                               <li key={pIdx} className="truncate border-b border-white/5 pb-1">{p.name}</li>
                             ))}
                           </ul>
                         </div>
                       ))}
                     </div>
                   ) : tripData.places && tripData.places.length > 0 ? (
                      <ol className="list-decimal list-inside space-y-2.5 text-sm font-bold text-slate-300">
                         {tripData.places.map((p, i) => (
                           <li key={i} className="truncate border-b border-white/5 pb-1">{p.name || p}</li>
                         ))}
                      </ol>
                   ) : (
                      <p className="text-xs text-slate-500 font-bold">No places specified on trip.</p>
                   )}
                </div>
              ) : (
                <p className="text-sm font-bold text-slate-500 bg-slate-900/50 p-4 rounded-xl border border-dashed border-white/10 text-center">No trip planner data exists.</p>
              )}
            </div>

            <div className="glass-panel p-6 rounded-3xl flex-grow">
              <h3 className="text-lg font-black text-white mb-4 border-b border-white/10 pb-3 flex items-center gap-2">🛡️ Assigned Guide</h3>
              {guideData ? (
                <div className="flex flex-col gap-3">
                   <p className="font-extrabold text-white text-xl tracking-tight">{guideData.name}</p>
                   <p className="text-sm font-bold text-slate-300 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-white/5 inline-block w-fit">
                     📞 {guideData.phone}
                   </p>
                   <p className="text-xs font-bold text-slate-400">Experience: {guideData.experience} Yrs</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-4 bg-slate-900/50 rounded-xl border border-dashed border-white/10 h-full">
                    <span className="text-4xl mb-2 grayscale opacity-50">🚶‍♂️</span>
                    <p className="text-sm font-bold text-slate-500">Tourist is traveling independently.</p>
                 </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
export default ParentDashboard;

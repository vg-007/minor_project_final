import React, { useState, useEffect } from 'react';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const RecenterMap = ({ lat, lng }) => {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) {
      map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
    }
  }, [lat, lng, map]);
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
           } else {
              setGuideData({ name: latestBooking.guideName, phone: 'N/A', experience: 'N/A' });
           }
        } else {
           setGuideData(null);
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
    let unsub = () => {};
    if (isLive && resolvedUserId) {
        const docRef = doc(db, 'locations', resolvedUserId);
        unsub = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            const lat = data.latitude;
            const lng = data.longitude;

            console.log('[ParentDashboard] Location snapshot received:', { lat, lng, timestamp: data.timestamp });

            // Handle both Date.now() numeric timestamps and ISO strings
            let formattedTime = '';
            if (data.timestamp) {
              const d = typeof data.timestamp === 'number'
                ? new Date(data.timestamp)
                : new Date(data.timestamp);
              formattedTime = isNaN(d.getTime()) ? String(data.timestamp) : d.toLocaleString();
            }

            setLocation({ lat, lng });
            setLastUpdated(formattedTime);
            setError('');
          } else {
            console.warn('[ParentDashboard] No location document for userId:', resolvedUserId);
            setError('Tourist has not started broadcasting yet.');
          }
        }, (err) => {
          console.error('[ParentDashboard] onSnapshot error:', err);
          setError('Live connection dropped. Check your network.');
        });
    }
    return () => unsub();
  }, [isLive, resolvedUserId]);

  return (
    <div className="max-w-7xl w-full mx-auto flex flex-col gap-6">
      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
        <h2 className="text-3xl font-extrabold text-emerald-900 mb-2 tracking-tight">Parent Dashboard</h2>
        <p className="text-gray-500 font-bold mb-6 text-sm">Enter the 6-Digit Tracker Alias (e.g., TR1234) for live metrics.</p>
        
        <div className="flex w-full max-w-xl gap-3 flex-col sm:flex-row">
          <input 
             type="text" 
             value={touristInput} 
             onChange={e => { setTouristInput(e.target.value.toUpperCase()); setIsLive(false); setResolvedUserId(null); }} 
             placeholder="Enter Code" 
             className="flex-1 px-5 py-4 rounded-xl border border-gray-200 focus:ring-4 focus:ring-emerald-100 focus:border-emerald-500 outline-none shadow-inner font-mono text-gray-800 font-black text-xl tracking-widest uppercase text-center" 
          />
          <button 
             onClick={executeLock}
             className="bg-emerald-600 text-white font-extrabold px-8 py-4 rounded-xl shadow-md hover:bg-emerald-700 transition"
          >
             Lock Target
          </button>
        </div>
        
        {error && <p className="text-red-500 mt-5 font-bold uppercase tracking-widest text-sm bg-red-50 px-5 py-2 rounded-xl border border-red-100">{error}</p>}
      </div>

      {resolvedUserId && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Map Content */}
          <div className="lg:col-span-2 bg-white p-3 rounded-3xl border border-gray-200 shadow-sm overflow-hidden relative z-0 flex flex-col min-h-[500px]">
            <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 mb-2 rounded-t-2xl">
               <h3 className="font-black text-gray-800 flex items-center gap-2">
                 <span className="animate-pulse text-red-500">🔴</span> Live GPS Feed
               </h3>
               <div className="flex flex-col items-end gap-1">
                 {lastUpdated && (
                   <span className="text-xs font-black text-gray-500 tracking-tight bg-gray-200/50 px-3 py-1.5 rounded-lg border border-gray-200">
                     Updated: {lastUpdated}
                   </span>
                 )}
                 {location && (
                   <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100 font-bold">
                     📍 {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                   </span>
                 )}
               </div>
            </div>
            
            {/* Map is always mounted to avoid remount flicker on location updates */}
            <div className={`relative flex-grow ${!location ? 'h-[500px]' : ''}`} style={{ height: '500px' }}>
              <MapContainer
                center={location ? [location.lat, location.lng] : [17.3850, 78.4867]}
                zoom={location ? 16 : 5}
                style={{ height: '100%', width: '100%' }}
                className="rounded-2xl z-0"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {location && (
                  <>
                    <Marker position={[location.lat, location.lng]}>
                      <Popup>
                        <div className="font-bold text-emerald-900 text-center">
                          📍 Tourist is here<br/>
                          <span className="text-xs font-normal text-gray-500">{lastUpdated}</span>
                        </div>
                      </Popup>
                    </Marker>
                    <RecenterMap lat={location.lat} lng={location.lng} />
                  </>
                )}
              </MapContainer>
              {!location && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400 font-bold bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 z-10">
                  Awaiting active GPS coordinates...
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
              <h3 className="text-lg font-black text-indigo-900 mb-4 border-b border-gray-100 pb-3 flex items-center gap-2">🗺️ Tourist Itinerary</h3>
              {tripData ? (
                <div>
                   <p className="font-bold text-sm text-indigo-700 mb-3 bg-indigo-50/50 px-3 py-2 border border-indigo-100 rounded-xl inline-block tracking-tight">
                     📍 Route: {tripData.city} {tripData.days && <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full ml-1">{tripData.days} Days</span>}
                   </p>
                   
                   {tripData.itinerary ? (
                     <div className="space-y-3">
                       {tripData.itinerary.map((day, dIdx) => (
                         <div key={dIdx}>
                           <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 mb-1">Day {day.day}</p>
                           <ul className="list-disc list-inside text-xs font-bold text-gray-700 ml-2">
                             {day.places.map((p, pIdx) => (
                               <li key={pIdx} className="truncate border-b border-gray-50 pb-1">{p.name}</li>
                             ))}
                           </ul>
                         </div>
                       ))}
                     </div>
                   ) : tripData.places && tripData.places.length > 0 ? (
                      <ol className="list-decimal list-inside space-y-2.5 text-sm font-bold text-gray-600">
                         {tripData.places.map((p, i) => (
                           <li key={i} className="truncate border-b border-gray-50 pb-1">{p.name || p}</li>
                         ))}
                      </ol>
                   ) : (
                      <p className="text-xs text-gray-400 font-bold">No places specified on trip.</p>
                   )}
                </div>
              ) : (
                <p className="text-sm font-bold text-gray-400 bg-gray-50 p-4 rounded-xl border border-dashed text-center">No trip planner data exists.</p>
              )}
            </div>

            <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm flex-grow">
              <h3 className="text-lg font-black text-emerald-900 mb-4 border-b border-gray-100 pb-3 flex items-center gap-2">🛡️ Assigned Guide</h3>
              {guideData ? (
                <div className="space-y-3">
                   <div className="bg-emerald-50/50 p-5 rounded-2xl border border-emerald-100 flex flex-col items-center justify-center text-center shadow-inner">
                     <p className="text-[10px] font-black uppercase text-emerald-600 tracking-widest mb-1 opacity-70">Guide Alias</p>
                     <p className="text-2xl font-black text-emerald-900 capitalize tracking-tight drop-shadow-sm">{guideData.name}</p>
                   </div>
                   <div className="flex justify-between items-center p-3.5 bg-gray-50 rounded-xl border border-gray-100 shadow-sm">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Contact</span>
                      <span className="text-sm font-black text-gray-800">{guideData.phone}</span>
                   </div>
                   <div className="flex justify-between items-center p-3.5 bg-gray-50 rounded-xl border border-gray-100 shadow-sm">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Experience</span>
                      <span className="text-sm font-black text-gray-800">{guideData.experience} Years</span>
                   </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl gap-3">
                   <span className="text-4xl grayscale opacity-30 drop-shadow">🧑‍💼</span>
                   <p className="text-xs font-bold text-gray-400 text-center px-4 leading-relaxed">No local guide has been hired yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ParentDashboard;

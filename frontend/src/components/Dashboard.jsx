import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, setDoc, onSnapshot, deleteDoc, addDoc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { motion } from 'framer-motion';
import MapComponent from './MapComponent';
import RoleHeader from './RoleHeader';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Tourist marker
const touristIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="position:relative; display:flex; justify-content:center; align-items:center;">
          <div style="position:absolute; width: 40px; height: 40px; background: rgba(59, 130, 246, 0.4); border-radius: 50%; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 20px; height: 20px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.4); z-index: 10;"></div>
         </div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// Guide marker
const guideIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="position:relative; display:flex; justify-content:center; align-items:center;">
          <div style="width: 32px; height: 32px; background: #f59e0b; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 15px #f59e0b; z-index: 10; display:flex; justify-content:center; align-items:center; font-size:16px;">🚶‍♂️</div>
         </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

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

const AutoFitBounds = ({ bounds }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true, duration: 1.5 });
    }
  }, [bounds, map]);
  return null;
};

const Dashboard = () => {
  const [latestTrip, setLatestTrip] = useState(null);
  const [loadingTrip, setLoadingTrip] = useState(true);
  
  const [shortCode, setShortCode] = useState('');
  const [nearbySpots, setNearbySpots] = useState([]);
  const [touristLocation, setTouristLocation] = useState(null);
  
  const [pendingCancellationBooking, setPendingCancellationBooking] = useState(null);
  const [bookingNeedingReview, setBookingNeedingReview] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');

  // Guide Tracking States
  const [activeBooking, setActiveBooking] = useState(null);
  const [guideLocation, setGuideLocation] = useState(null);
  const [guideInfo, setGuideInfo] = useState(null);

  // Cancellation and Review Listeners
  useEffect(() => {
    let unsubBookings = () => {};
    const authUnsub = auth.onAuthStateChanged((user) => {
      if (user) {
        const q = query(
          collection(db, 'bookings'), 
          where('touristId', '==', user.uid), 
          where('status', 'in', ['guide_cancel_requested', 'completed', 'cancelled'])
        );
        unsubBookings = onSnapshot(q, (snap) => {
          let cancelReq = null;
          let needsReview = null;
          
          snap.docs.forEach(d => {
            const data = d.data();
            if (data.status === 'guide_cancel_requested') {
              cancelReq = { id: d.id, ...data };
            } else if (data.status === 'completed' || data.status === 'cancelled') {
              needsReview = { id: d.id, ...data };
            }
          });
          
          setPendingCancellationBooking(cancelReq);
          setBookingNeedingReview(needsReview);
        });
      } else {
        unsubBookings();
      }
    });
    return () => { authUnsub(); unsubBookings(); };
  }, []);

  // Active Booking Listener
  useEffect(() => {
    let unsubActive = () => {};
    const authUnsub = auth.onAuthStateChanged((user) => {
      if (user) {
        const q = query(
          collection(db, 'bookings'),
          where('touristId', '==', user.uid),
          where('status', '==', 'accepted')
        );
        unsubActive = onSnapshot(q, (snap) => {
          if (!snap.empty) {
            setActiveBooking({ id: snap.docs[0].id, ...snap.docs[0].data() });
          } else {
            setActiveBooking(null);
            setGuideLocation(null);
            setGuideInfo(null);
          }
        });
      }
    });
    return () => { authUnsub(); unsubActive(); };
  }, []);

  // Guide Location Listener
  useEffect(() => {
    let unsubLoc = () => {};
    if (activeBooking?.guideId) {
      getDoc(doc(db, 'guides', activeBooking.guideId)).then(snap => {
        if (snap.exists()) setGuideInfo(snap.data());
      });

      unsubLoc = onSnapshot(doc(db, 'locations', activeBooking.guideId), (docSnap) => {
        if (docSnap.exists()) {
          setGuideLocation(docSnap.data());
          console.log("Guide tracking active");
          console.log("Guide location:", docSnap.data());
        }
      });
    }
    return () => unsubLoc();
  }, [activeBooking]);

  // General App Setup
  useEffect(() => {
    let isMounted = true;
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!isMounted) return;
      if (!user) { setLoadingTrip(false); return; }
      
      // Fetch latest trip
      try {
        const q = query(collection(db, 'trips'), where('userId', '==', user.uid));
        const snap = await getDocs(q);
        if (!isMounted) return;
        if (!snap.empty) {
          const trips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          trips.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          setLatestTrip(trips[0]);
        }
      } catch (err) {
        console.error('Dashboard trip fetch error:', err);
      } finally {
        if (isMounted) setLoadingTrip(false);
      }

      // Fetch or generate Tourist Code
      try {
        const codeQuery = query(collection(db, 'touristCodes'), where('userId', '==', user.uid));
        const codeSnap = await getDocs(codeQuery);
        if (!isMounted) return;

        if (!codeSnap.empty) {
          setShortCode(codeSnap.docs[0].data().code);
        } else {
          let isUnique = false;
          let newCode = '';
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          while (!isUnique) {
            newCode = 'TR';
            for (let i = 0; i < 4; i++) {
              newCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            const existSnap = await getDocs(query(collection(db, 'touristCodes'), where('code', '==', newCode)));
            if (existSnap.empty) isUnique = true;
          }
          await setDoc(doc(db, 'touristCodes', newCode), { code: newCode, userId: user.uid });
          if (isMounted) setShortCode(newCode);
        }
      } catch (err) {
        console.error('Code generation error:', err);
      }
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  const handleLocationUpdate = async (lat, lon) => {
    setTouristLocation({ lat, lng: lon });
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'locations', auth.currentUser.uid), {
        userId: auth.currentUser.uid,
        latitude: lat,
        longitude: lon,
        source: 'gps',
        timestamp: Date.now(),
        type: 'tourist'
      }, { merge: true });
    } catch(err) {
      console.error('Failed to sync location', err);
    }
  };

  const handleAttractionsFound = (attractions) => {
    setNearbySpots(attractions.slice(0, 6));
  };

  const handleCancelDecision = async (decision) => {
    if (!pendingCancellationBooking) return;
    try {
      console.log("Tourist cancellation decision:", decision);
      if (decision === 'accept') {
        await setDoc(doc(db, 'bookings', pendingCancellationBooking.id), { status: 'cancelled' }, { merge: true });
      } else {
        await setDoc(doc(db, 'bookings', pendingCancellationBooking.id), { status: 'accepted', cancelRequested: false }, { merge: true });
      }
      setPendingCancellationBooking(null);
    } catch (err) {
      console.error('Cancellation decision failed:', err);
    }
  };

  const handleReviewSubmission = async (action) => {
    if (!bookingNeedingReview) return;
    const { id: bookingId, guideId } = bookingNeedingReview;
    
    try {
      if (action === 'submit') {
        console.log("Review submitted");
        await addDoc(collection(db, 'reviews'), {
          guideId: guideId,
          userId: auth.currentUser.uid,
          touristName: auth.currentUser.displayName || auth.currentUser.email,
          rating: Number(reviewRating),
          comment: reviewText,
          createdAt: new Date().toISOString()
        });

        const guideRef = doc(db, 'guides', guideId);
        const guideSnap = await getDoc(guideRef);
        if (guideSnap.exists()) {
          const gData = guideSnap.data();
          const currentTotal = gData.totalReviews || 0;
          const currentRating = gData.rating || 0;
          const newTotalRevs = currentTotal + 1;
          const newAvgRating = ((currentRating * currentTotal) + Number(reviewRating)) / newTotalRevs;

          await updateDoc(guideRef, {
             rating: Number(newAvgRating.toFixed(1)),
             totalReviews: newTotalRevs
          });
        }
      } else {
        console.log("Review skipped");
      }

      await deleteDoc(doc(db, 'bookings', bookingId));
      setBookingNeedingReview(null);
      setReviewText('');
      setReviewRating(5);
    } catch (err) {
      console.error("Failed to process review/cleanup:", err);
    }
  };

  return (
    <div className="w-full max-w-7xl flex flex-col items-center gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <RoleHeader role="tourist" />
      
      {/* Cancellation Banner */}
      {pendingCancellationBooking && (
        <motion.div initial={{ opacity: 0, y: -50 }} animate={{ opacity: 1, y: 0 }} className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] w-[90%] max-w-lg glass-panel bg-red-900/80 text-white p-6 rounded-3xl border border-red-500/50 flex flex-col items-center text-center">
          <div className="text-4xl mb-3 bg-red-500/30 p-3 rounded-full border border-red-400 shadow-inner">⚠️</div>
          <h3 className="text-2xl font-black tracking-tight mb-2 text-red-100">Tour Cancellation Requested</h3>
          <p className="font-medium text-red-200 mb-6 text-sm">
            Your assigned guide <strong className="text-white">{pendingCancellationBooking.guideName || 'Guide'}</strong> has requested to cancel this trip. Do you accept this cancellation?
          </p>
          <div className="flex gap-4 w-full">
            <button
              onClick={() => handleCancelDecision('reject')}
              className="flex-1 bg-red-800 text-white font-bold py-3 px-2 rounded-xl shadow border border-red-900 hover:bg-red-900 transition"
            >
              Reject (Keep Active)
            </button>
            <button
              onClick={() => handleCancelDecision('accept')}
              className="flex-1 bg-white text-red-700 font-extrabold py-3 px-2 rounded-xl shadow hover:bg-gray-100 hover:scale-105 transition-all"
            >
              Accept Cancel
            </button>
          </div>
        </motion.div>
      )}

      {/* Review Modal */}
      {bookingNeedingReview && !pendingCancellationBooking && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[9999] w-[90%] max-w-md glass-panel bg-slate-900/90 text-white p-6 rounded-3xl border border-cyan-500/30 flex flex-col items-center shadow-cyan-500/10">
          <div className="text-4xl mb-3 bg-cyan-500/20 p-3 rounded-full border border-cyan-400/50 shadow-inner shadow-cyan-500/20">⭐</div>
          <h3 className="text-2xl font-black tracking-tight mb-1 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-fuchsia-400">Rate Your Guide</h3>
          <p className="text-slate-300 mb-6 text-sm text-center">
            How was your experience with <strong className="text-white">{bookingNeedingReview.guideName || 'your guide'}</strong>?
          </p>
          
          <div className="w-full flex flex-col gap-4 mb-6">
            <div className="flex justify-between items-center bg-blue-800/50 p-3 rounded-xl border border-blue-700">
              <label className="font-bold text-sm text-blue-100">Rating:</label>
              <select 
                className="bg-white text-blue-900 font-black px-3 py-1.5 rounded-lg border-none outline-none" 
                value={reviewRating} 
                onChange={e => setReviewRating(e.target.value)}
              >
                <option value="5">⭐⭐⭐⭐⭐ (5)</option>
                <option value="4">⭐⭐⭐⭐ (4)</option>
                <option value="3">⭐⭐⭐ (3)</option>
                <option value="2">⭐⭐ (2)</option>
                <option value="1">⭐ (1)</option>
              </select>
            </div>
            <textarea 
              className="glass-input w-full p-4 rounded-xl font-medium text-sm"
              rows="3"
              placeholder="Write a short review..."
              value={reviewText}
              onChange={e => setReviewText(e.target.value)}
            ></textarea>
          </div>
          
          <div className="flex gap-4 w-full">
            <button
              onClick={() => handleReviewSubmission('skip')}
              className="flex-1 bg-blue-800/50 text-blue-200 font-bold py-3 px-2 rounded-xl border border-blue-700 hover:bg-blue-800 transition"
            >
              Skip
            </button>
            <button
              onClick={() => handleReviewSubmission('submit')}
              className="flex-1 bg-white text-blue-900 font-extrabold py-3 px-2 rounded-xl shadow hover:bg-gray-100 transition"
            >
              Submit Review
            </button>
          </div>
        </motion.div>
      )}

      {/* Hero Banner */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full bg-white/10 backdrop-blur-2xl p-10 rounded-[2rem] relative overflow-hidden group flex flex-col md:flex-row md:items-center justify-between gap-6 border border-white/30 shadow-[0_8px_32px_rgba(34,211,238,0.15)]">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-100/10 to-blue-200/10"></div>
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-10 mix-blend-overlay"></div>
        <div className="absolute -top-10 -right-10 opacity-10 text-[200px] pointer-events-none group-hover:rotate-12 group-hover:scale-110 transition-transform duration-1000 select-none">🌍</div>
        
        <div className="relative z-10">
          <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-400 mb-4 tracking-tighter drop-shadow-sm">
            Tourist Dashboard
          </h2>
          <p className="text-teal-100 font-medium text-lg max-w-xl">
            Explore your surroundings, manage your trip, and stay connected with your guardian.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <span className="bg-white/10 backdrop-blur-md border border-white/20 text-white font-bold px-5 py-2.5 rounded-full text-sm flex items-center gap-2 shadow-inner">
              <span className="animate-bounce">📍</span> Live Map Active
            </span>
            <span className="bg-emerald-500/20 backdrop-blur-md border border-emerald-400/30 text-emerald-100 font-bold px-5 py-2.5 rounded-full text-sm flex items-center gap-2 shadow-inner">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> GPS Broadcasting
            </span>
          </div>
        </div>

        {shortCode && (
          <div className="relative z-10 bg-white/10 backdrop-blur-md border-2 border-teal-400/50 p-6 rounded-2xl flex flex-col items-center text-center shadow-lg transform transition hover:scale-105">
            <p className="text-teal-100 font-bold text-sm uppercase tracking-widest mb-2">Guardian Tracking Code</p>
            <p className="text-5xl font-black text-white tracking-widest font-mono drop-shadow-md">{shortCode}</p>
            <p className="text-xs text-teal-200 mt-3 font-semibold">Share this code with your family</p>
          </div>
        )}
      </motion.div>

      {/* Guide Tracking Section */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100">
        <div className="flex justify-between items-end mb-6">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-600 mb-2">Live Status</p>
            <h3 className="text-3xl font-black text-slate-800">🧭 Track Your Guide</h3>
          </div>
        </div>

        {activeBooking ? (
          <div className="flex flex-col gap-6">
            {/* Guide Map */}
            <div className="w-full h-[400px] rounded-2xl overflow-hidden border-4 border-orange-100 shadow-inner relative z-0">
              <MapContainer 
                center={touristLocation ? [touristLocation.lat, touristLocation.lng] : [17.3850, 78.4867]} 
                zoom={14} 
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
                  url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                />
                
                {touristLocation && (
                  <Marker position={[touristLocation.lat, touristLocation.lng]} icon={touristIcon}>
                    <Popup><div className="font-bold text-center">📍 You are here</div></Popup>
                  </Marker>
                )}

                {guideLocation && (
                  <Marker position={[guideLocation.latitude, guideLocation.longitude]} icon={guideIcon}>
                    <Popup>
                      <div className="font-bold text-center text-orange-700">
                        🚶‍♂️ {activeBooking.guideName}
                        <br/>
                        <span className="text-xs font-normal text-slate-500">Live Location</span>
                      </div>
                    </Popup>
                  </Marker>
                )}

                {/* Auto Center on both if they exist */}
                {touristLocation && guideLocation && (
                  <AutoFitBounds bounds={[
                    [touristLocation.lat, touristLocation.lng],
                    [guideLocation.latitude, guideLocation.longitude]
                  ]} />
                )}
              </MapContainer>
            </div>

            {/* Guide Details Card */}
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="bg-orange-100 text-orange-600 text-3xl w-16 h-16 rounded-full flex items-center justify-center font-bold border-2 border-orange-200 shadow-sm">
                  {activeBooking.guideName ? activeBooking.guideName[0].toUpperCase() : 'G'}
                </div>
                <div>
                  <h4 className="text-xl font-black text-slate-800">{activeBooking.guideName}</h4>
                  <p className="text-sm font-bold text-orange-600 uppercase tracking-widest mt-1">Guide Assigned</p>
                </div>
              </div>
              
              <div className="flex gap-4 flex-wrap justify-center">
                <div className="bg-white px-4 py-2 rounded-xl border border-orange-100 shadow-sm text-center">
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Status</p>
                  <p className="text-sm font-black text-emerald-600 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Active Tracking
                  </p>
                </div>
                <div className="bg-white px-4 py-2 rounded-xl border border-orange-100 shadow-sm text-center">
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Distance</p>
                  <p className="text-sm font-black text-slate-700">
                    {touristLocation && guideLocation ? 
                      `${getDistance(touristLocation.lat, touristLocation.lng, guideLocation.latitude, guideLocation.longitude).toFixed(2)} km` 
                      : 'Calculating...'}
                  </p>
                </div>
                {guideLocation?.timestamp && (
                  <div className="bg-white px-4 py-2 rounded-xl border border-orange-100 shadow-sm text-center">
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Last Update</p>
                    <p className="text-sm font-black text-slate-700">
                      {new Date(guideLocation.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
             <span className="text-5xl opacity-40 mb-4 grayscale">🚶‍♂️</span>
             <h4 className="text-xl font-black text-slate-500">No active guide assigned</h4>
             <p className="text-sm text-slate-400 mt-2 font-medium">Book a guide from your active trip to start live tracking.</p>
          </div>
        )}
      </motion.div>

      {/* Map (Primary Tourist Map) */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="w-full bg-white/10 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_rgba(255,255,255,0.1)] p-2 md:p-4 rounded-[2rem] relative z-0">
        <div className="w-full rounded-2xl overflow-hidden relative isolate border border-white/20 bg-slate-50/50">
          <MapComponent 
             onLocationUpdate={handleLocationUpdate}
             onAttractionsFound={handleAttractionsFound}
          />
        </div>
      </motion.div>

      {/* Nearby Spots Panel */}
      {nearbySpots.length > 0 && (
        <div className="w-full bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100">
          <div className="flex justify-between items-end mb-6">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-teal-600 mb-2">Live Discovery</p>
              <h3 className="text-3xl font-black text-slate-800">Tourist Spots Near You</h3>
            </div>
            <span className="bg-teal-50 text-teal-700 text-sm font-bold px-4 py-2 rounded-xl border border-teal-100">
              Within 6km
            </span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {nearbySpots.map((spot) => (
              <div key={spot.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-shadow group flex flex-col justify-between">
                <div>
                  <h4 className="font-extrabold text-lg text-slate-900 leading-tight mb-2 group-hover:text-teal-700 transition-colors">{spot.name}</h4>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{spot.distance} km away</p>
                </div>
                {spot.address && (
                  <p className="text-sm text-slate-600 mt-3 font-medium border-l-2 border-teal-400 pl-3">{spot.address}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Trip Panel */}
      <div className="w-full">
        {loadingTrip ? (
          <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 animate-pulse">
            <div className="flex flex-col gap-3 w-1/2">
               <div className="h-4 bg-gray-200 rounded w-1/4"></div>
               <div className="h-8 bg-gray-200 rounded w-1/2"></div>
               <div className="flex gap-2">
                 <div className="h-6 bg-gray-100 rounded-full w-16"></div>
                 <div className="h-6 bg-gray-100 rounded-full w-20"></div>
                 <div className="h-6 bg-gray-100 rounded-full w-24"></div>
               </div>
            </div>
            <div className="h-12 bg-gray-200 rounded-xl w-40"></div>
          </div>
        ) : latestTrip ? (
          <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100 relative overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1">
            <div className="absolute -top-8 -right-8 opacity-5 text-[150px] pointer-events-none select-none">🗺️</div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-teal-600 mb-2">Your Active Trip</p>
                <h3 className="text-3xl font-black text-slate-800 flex items-center gap-3">
                  <span className="bg-teal-500 w-3 h-3 rounded-full animate-pulse shadow-lg shadow-teal-500/50" />
                  {latestTrip.city}
                </h3>
                <div className="flex gap-2 mt-3">
                  <span className="text-xs font-bold bg-teal-50 border border-teal-100 text-teal-700 px-3 py-1 rounded-full">
                    {latestTrip.days || 1} day{(latestTrip.days || 1) > 1 ? 's' : ''}
                  </span>
                  <span className="text-xs font-bold bg-slate-50 border border-slate-200 text-slate-600 px-3 py-1 rounded-full">
                    {latestTrip.places?.length || 0} stops
                  </span>
                  <span className="text-xs font-bold bg-slate-50 border border-slate-200 text-slate-400 px-3 py-1 rounded-full">
                    {new Date(latestTrip.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <Link
                to="/trip-planner"
                className="bg-gradient-to-r from-teal-500 to-blue-600 text-white font-extrabold px-8 py-3.5 rounded-xl hover:shadow-teal-500/30 transition-all duration-300 shadow-lg hover:-translate-y-0.5 active:scale-95 whitespace-nowrap relative overflow-hidden group"
              >
                <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
                📋 Manage Trips
              </Link>
            </div>

            {/* Places list — day-based or flat */}
            {latestTrip.itinerary ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {latestTrip.itinerary.map(d => (
                  <div key={d.day} className="bg-teal-50 rounded-2xl p-4 border border-teal-100">
                    <p className="text-xs font-black uppercase tracking-widest text-teal-600 mb-2">Day {d.day}</p>
                    <div className="flex flex-col gap-1.5">
                      {d.places.map((p, i) => (
                        <p key={i} className="text-sm font-bold text-gray-700 flex items-center gap-2 truncate">
                          <span className="bg-teal-500 text-white text-[10px] font-black w-5 h-5 rounded flex items-center justify-center shrink-0">{i + 1}</span>
                          {p.name}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {latestTrip.places?.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                    <div className="bg-teal-500 text-white font-black text-xs w-6 h-6 rounded-lg flex items-center justify-center shrink-0">
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="font-extrabold text-gray-800 text-sm truncate">{p.name}</p>
                      {p.openingTime && (
                        <p className="text-xs text-gray-400 font-bold">{p.openingTime}{p.closingTime ? ` – ${p.closingTime}` : ''}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white p-12 rounded-[2rem] border-2 border-dashed border-gray-200 shadow-sm flex flex-col items-center gap-5 transition-all hover:bg-slate-50">
            <span className="text-6xl opacity-30 animate-bounce">🗺️</span>
            <p className="text-slate-500 font-black text-xl">No trip planned yet.</p>
            <Link
              to="/trip-planner"
              className="bg-gradient-to-r from-teal-500 to-blue-500 text-white font-extrabold px-8 py-3.5 rounded-xl transition-all duration-300 shadow-lg hover:shadow-teal-500/30 hover:-translate-y-0.5 active:scale-95 group relative overflow-hidden"
            >
              <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
              📋 Plan Your First Trip
            </Link>
          </div>
        )}
      </div>

    </div>
  );
};

export default Dashboard;

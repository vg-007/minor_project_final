import React, { useState, useEffect } from 'react';
import RoleHeader from './RoleHeader';
import { collection, onSnapshot, getDocs, doc, setDoc, query, where, addDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { motion } from 'framer-motion';

const Guides = () => {
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [filterLang, setFilterLang] = useState('');
  const [filterExp, setFilterExp] = useState('');
  const [priceRange, setPriceRange] = useState(''); 
  const [filterLocation, setFilterLocation] = useState('');
  const [detectingLoc, setDetectingLoc] = useState(false);

  const [bookingStatus, setBookingStatus] = useState({});
  // Per-guide inline feedback (e.g. "Booking sent!") to replace alert()
  const [bookingFeedback, setBookingFeedback] = useState({});
  // Per-guide phone reveal toggle
  const [shownPhone, setShownPhone] = useState({});

  // Reviews System State
  const [expandedGuideId, setExpandedGuideId] = useState(null);
  const [guideReviews, setGuideReviews] = useState([]);
  const [reviewText, setReviewText] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [loadingReviews, setLoadingReviews] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let unsubGuides = () => {};

    const setupListeners = async () => {
      setLoading(true);
      try {
        unsubGuides = onSnapshot(collection(db, "guides"), (querySnapshot) => {
          if (!isMounted) return;
          const guidesList = querySnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(g => g && g.name && Object.keys(g).length > 2); // Filter invalid ones
          setGuides(guidesList);
          setLoading(false);
        }, (error) => {
          console.error("Error fetching guides:", error);
          if (isMounted) setLoading(false);
        });

        if (auth.currentUser) {
           const bQ = query(collection(db, 'bookings'), where('touristId', '==', auth.currentUser.uid));
           const bSnap = await getDocs(bQ);
           if (!isMounted) return;
           const statuses = {};
           bSnap.docs.forEach(d => {
              const bData = d.data();
              if (bData.status === 'requested' || bData.status === 'accepted') {
                 statuses[bData.guideId] = bData.status;
              }
           });
           setBookingStatus(statuses);
        }
      } catch (error) {
        console.error("Error setting up listeners:", error);
        if (isMounted) setLoading(false);
      }
    };
    
    setupListeners();

    return () => {
      isMounted = false;
      unsubGuides();
    };
  }, []);

  const handleDetectLocation = () => {
    setDetectingLoc(true);
    if (!navigator.geolocation) {
      alert('Geolocation not supported');
      setDetectingLoc(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const { latitude, longitude } = pos.coords;
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
            const data = await res.json();
            const city = data.address?.city || data.address?.town || data.address?.county || '';
            const state = data.address?.state || '';
            setFilterLocation(city || state);
        } catch(err) {
            alert('Failed to detect location');
        } finally {
            setDetectingLoc(false);
        }
    }, (err) => {
        alert('Location access denied');
        setDetectingLoc(false);
    });
  };

  const handleBookGuide = async (guide) => {
    if (!auth.currentUser) {
      setBookingFeedback(prev => ({ ...prev, [guide.id]: { type: 'error', msg: 'Please login first.' } }));
      return;
    }

    // Bug fix: Firestore duplicate check — prevent double bookings even on rapid clicks
    try {
      const dupQ = query(
        collection(db, 'bookings'),
        where('touristId', '==', auth.currentUser.uid),
        where('guideId', '==', guide.id),
        where('status', 'in', ['requested', 'accepted'])
      );
      const dupSnap = await getDocs(dupQ);
      if (!dupSnap.empty) {
        setBookingStatus(prev => ({ ...prev, [guide.id]: dupSnap.docs[0].data().status }));
        return;
      }
    } catch (err) {
      console.error('Duplicate check failed:', err);
    }

    let attachedPlaces = [];
    let attachedCity = '';
    let attachedItinerary = null;
    let attachedDays = 1;

    try {
       const q = query(collection(db, 'trips'), where('userId', '==', auth.currentUser.uid));
       const snapshot = await getDocs(q);
       if (!snapshot.empty) {
          const tripsList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          tripsList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          const latestTrip = tripsList[0];
          attachedPlaces = latestTrip.places || [];
          attachedCity = latestTrip.city || '';
          attachedItinerary = latestTrip.itinerary || null;
          attachedDays = latestTrip.days || 1;
       }
    } catch (err) {
       console.error('Failed to link trip data', err);
    }

    // Use a deterministic bookingId (touristId_guideId) to prevent duplicates at the DB level too
    const bookingId = `${auth.currentUser.uid}_${guide.id}`;
    const bookingData = {
      touristId: auth.currentUser.uid,
      guideId: guide.id,
      touristName: auth.currentUser.displayName || auth.currentUser.email,
      guideName: guide.name,
      status: 'requested',
      tripCity: attachedCity,
      tripPlaces: attachedPlaces,
      tripItinerary: attachedItinerary,
      tripDays: attachedDays,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'bookings', bookingId), bookingData);
      setBookingStatus(prev => ({ ...prev, [guide.id]: 'requested' }));
      setBookingFeedback(prev => ({ ...prev, [guide.id]: { type: 'success', msg: `Request sent to ${guide.name}!` } }));
      setTimeout(() => setBookingFeedback(prev => { const n = { ...prev }; delete n[guide.id]; return n; }), 4000);
    } catch (err) {
      console.error(err);
      setBookingFeedback(prev => ({ ...prev, [guide.id]: { type: 'error', msg: 'Failed to send request. Try again.' } }));
    }
  };

  const handleToggleReviews = async (guide) => {
    if (expandedGuideId === guide.id) {
      setExpandedGuideId(null);
      return;
    }
    setExpandedGuideId(guide.id);
    setGuideReviews([]);
    setLoadingReviews(true);
    setReviewText('');
    setReviewRating(5);
    try {
      const q = query(collection(db, 'reviews'), where('guideId', '==', guide.id));
      const snap = await getDocs(q);
      const revs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      revs.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
      setGuideReviews(revs);
    } catch(err) {
       console.error("Failed to load reviews");
    } finally {
      setLoadingReviews(false);
    }
  };

  const submitReview = async (guide) => {
    if (!auth.currentUser) return alert("Please login to write a review.");
    if (!reviewText.trim()) return alert("Please enter a review comment.");

    try {
       const newReview = {
         guideId: guide.id,
         userId: auth.currentUser.uid,
         touristName: auth.currentUser.displayName || auth.currentUser.email,
         rating: Number(reviewRating),
         comment: reviewText,
         createdAt: new Date().toISOString()
       };
       await addDoc(collection(db, 'reviews'), newReview);

       const currentTotal = guide.totalReviews || 0;
       const currentRating = guide.rating || 0;
       const newTotalRevs = currentTotal + 1;
       const newAvgRating = ((currentRating * currentTotal) + Number(reviewRating)) / newTotalRevs;

       await updateDoc(doc(db, 'guides', guide.id), {
          rating: Number(newAvgRating.toFixed(1)),
          totalReviews: newTotalRevs
       });

       setGuides(prev => prev.map(g => g.id === guide.id ? { ...g, rating: Number(newAvgRating.toFixed(1)), totalReviews: newTotalRevs } : g));
       setGuideReviews(prev => [newReview, ...prev]);
       setReviewText('');
       setReviewRating(5);
    } catch (err) {
       console.error(err);
       alert("Failed to submit review");
    }
  };

  const filteredGuides = guides.filter(g => {
    if (!g || !g.name) return false;
    let match = true;
    if (filterLang) {
      const langArray = Array.isArray(g.languages) ? g.languages : [g.languages];
      const hasLang = langArray.some(l => l?.toLowerCase().includes(filterLang.toLowerCase()));
      match = match && hasLang;
    }
    if (filterExp) {
      match = match && (g.experience >= Number(filterExp));
    }
    if (priceRange) {
      match = match && (g.price <= Number(priceRange));
    }
    if (filterLocation) {
      const loc = filterLocation.toLowerCase();
      const gCity = (g.city || '').toLowerCase();
      const gState = (g.state || '').toLowerCase();
      match = match && (gCity.includes(loc) || gState.includes(loc));
    }
    return match;
  });

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-8 text-slate-200">
      <RoleHeader role="tourist" />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-10 rounded-3xl overflow-hidden relative border border-cyan-500/30">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 mix-blend-overlay"></div>
        <div className="absolute top-0 right-0 opacity-10 text-[180px] leading-none transform translate-x-12 -translate-y-8 pointer-events-none drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]">📍</div>
        <h2 className="text-5xl font-extrabold mb-4 tracking-tight relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400 drop-shadow-md">Discover Local Guides</h2>
        <p className="text-cyan-100 font-medium text-xl max-w-2xl relative z-10">Find the perfect companion offering unique local experiences suited specifically to your requests.</p>
        
        {/* Strict Filters Layer */}
        <div className="flex flex-col md:flex-row gap-5 mt-10 bg-slate-900/50 p-6 rounded-2xl border border-white/10 backdrop-blur-md relative z-10">
          <div className="w-full md:w-1/4">
            <label className="block text-sm font-bold text-cyan-300 mb-2 uppercase tracking-wider">Location Match</label>
            <div className="flex gap-2">
               <input type="text" placeholder="City or State" className="glass-input w-full px-5 py-3 rounded-xl" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} />
               <button onClick={handleDetectLocation} title="Auto-detect Location" className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-3 rounded-xl transition shadow border border-cyan-400/50">
                  {detectingLoc ? '⏳' : '📍'}
               </button>
            </div>
          </div>
          <div className="w-full md:w-1/4">
            <label className="block text-sm font-bold text-cyan-300 mb-2 uppercase tracking-wider">Language Match</label>
            <input type="text" placeholder="e.g. English" className="glass-input w-full px-5 py-3 rounded-xl" value={filterLang} onChange={(e) => setFilterLang(e.target.value)} />
          </div>
          <div className="w-full md:w-1/4">
            <label className="block text-sm font-bold text-cyan-300 mb-2 uppercase tracking-wider">Min Experience</label>
            <input type="number" placeholder="Years (0)" min="0" className="glass-input w-full px-5 py-3 rounded-xl" value={filterExp} onChange={(e) => setFilterExp(e.target.value)} />
          </div>
          <div className="w-full md:w-1/4">
            <label className="block text-sm font-bold text-cyan-300 mb-2 uppercase tracking-wider">Max Price / Day</label>
            <input type="number" placeholder="$ Any" min="0" className="glass-input w-full px-5 py-3 rounded-xl" value={priceRange} onChange={(e) => setPriceRange(e.target.value)} />
          </div>
        </div>
      </motion.div>

      <div className="w-full">
        {loading ? (
          <div className="text-center text-slate-400 py-20 text-xl font-bold glass-panel rounded-3xl">Syncing with Firestore Network...</div>
        ) : filteredGuides.length === 0 ? (
          <div className="text-center text-slate-500 py-24 glass-panel rounded-3xl border-2 border-dashed border-white/10 text-xl font-bold">No guides available for this location</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredGuides.map(g => (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} key={g.id} className="glass-panel p-8 rounded-3xl hover:-translate-y-2 transition-all duration-300 relative overflow-hidden group flex flex-col hover:shadow-[0_0_30px_rgba(34,211,238,0.2)]">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-cyan-400 to-fuchsia-500 transform origin-left transition-transform group-hover:scale-x-100"></div>
                
                <div className="flex justify-between items-start mb-6">
                  <div>
                     <h3 className="font-extrabold text-3xl text-white truncate tracking-tight">{g.name}</h3>
                     <div className="flex items-center gap-2 mt-1.5">
                       <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded shadow-sm flex items-center gap-1 ${g.status === 'Busy' ? 'bg-red-900/50 text-red-300 border border-red-500/50' : 'bg-emerald-900/50 text-emerald-300 border border-emerald-500/50'}`}>
                         <span className={`w-1.5 h-1.5 rounded-full ${g.status === 'Busy' ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`}></span>
                         {g.status === 'Busy' ? 'Busy' : 'Available'}
                       </span>
                       <span className="text-sm text-slate-400 font-bold uppercase tracking-widest">{g.totalReviews || 0} Global Reviews</span>
                     </div>
                  </div>
                  <span className="bg-yellow-900/50 text-yellow-300 border border-yellow-500/30 text-sm font-black px-4 py-1.5 rounded-full flex items-center shadow-sm">
                    ★ {g.rating || 0}
                  </span>
                </div>
                
                <div className="text-slate-300 space-y-4 text-sm mb-8 bg-slate-900/50 p-5 rounded-2xl border border-white/10">
                  <p className="flex justify-between items-center"><strong className="text-slate-500 uppercase text-[11px] tracking-widest font-bold">Location</strong> <span className="font-extrabold text-cyan-300 text-right">{g.city || 'Any'}{g.state ? `, ${g.state}` : ''}</span></p>
                  <p className="flex justify-between items-center"><strong className="text-slate-500 uppercase text-[11px] tracking-widest font-bold">Languages</strong> <span className="font-extrabold text-cyan-300 text-right truncate pl-4">{Array.isArray(g.languages) ? g.languages.join(', ') : g.languages}</span></p>
                  <p className="flex justify-between items-center"><strong className="text-slate-500 uppercase text-[11px] tracking-widest font-bold">Experience</strong> <span className="font-extrabold text-slate-200">{g.experience} Years</span></p>
                  <p className="flex justify-between items-center"><strong className="text-slate-500 uppercase text-[11px] tracking-widest font-bold">Rate/Day</strong> <span className="font-black text-emerald-400 bg-emerald-900/30 px-3 py-1 rounded-lg border border-emerald-500/30">${g.price}</span></p>
                </div>
                
                <div className="flex flex-col gap-3 mt-auto">
                  {/* Contact button: shows phone inline OR opens tel: — no routing bug */}
                  {shownPhone[g.id] ? (
                    <div className="w-full flex items-center justify-between bg-slate-900 border border-white/10 rounded-xl px-4 py-3 shadow-sm">
                      <span className="font-extrabold text-white tracking-wide">{g.phone}</span>
                      <div className="flex gap-2">
                        <a
                          href={`tel:${g.phone}`}
                          className="bg-emerald-600/80 backdrop-blur-md border border-emerald-400/50 text-white text-sm font-bold px-3 py-1.5 rounded-lg hover:bg-emerald-500 transition"
                          onClick={(e) => e.stopPropagation()}
                        >
                          📞 Call
                        </a>
                        <button
                          onClick={() => setShownPhone(prev => ({ ...prev, [g.id]: false }))}
                          className="text-slate-400 hover:text-white text-sm font-bold px-2"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShownPhone(prev => ({ ...prev, [g.id]: true }))}
                      className="w-full text-center bg-slate-800/50 text-slate-300 font-extrabold py-3.5 rounded-xl border border-white/10 hover:bg-slate-700/50 hover:text-white transition-colors shadow-sm"
                    >
                      📞 Show Contact
                    </button>
                  )}

                  {/* Inline booking feedback (replaces alert) */}
                  {bookingFeedback[g.id] && (
                    <div className={`text-sm font-bold px-4 py-2 rounded-xl border ${
                      bookingFeedback[g.id].type === 'success'
                        ? 'bg-emerald-900/50 text-emerald-300 border-emerald-500/50'
                        : 'bg-red-900/50 text-red-300 border-red-500/50'
                    }`}>
                      {bookingFeedback[g.id].type === 'success' ? '✓' : '⚠️'} {bookingFeedback[g.id].msg}
                    </div>
                  )}

                  {g.status === 'Busy' ? (
                     <button disabled className="w-full text-center bg-slate-900 text-slate-500 font-extrabold py-3.5 rounded-xl cursor-not-allowed border border-white/5">
                       Guide Currently Unavailable
                     </button>
                  ) : bookingStatus[g.id] === 'requested' ? (
                     <button disabled className="w-full text-center bg-yellow-900/30 text-yellow-500 font-extrabold py-3.5 rounded-xl cursor-not-allowed border border-yellow-500/30">
                       ⏳ Booking Request Pending...
                     </button>
                  ) : bookingStatus[g.id] === 'accepted' ? (
                     <div className="w-full text-center bg-emerald-900/30 text-emerald-300 font-extrabold py-3 px-2 rounded-xl border-2 border-emerald-500/50 shadow-inner flex flex-col gap-1">
                       <span className="text-sm">✅ Booking Accepted!</span>
                       {g.guideCode ? (
                         <span className="text-xs bg-slate-900 px-3 py-1 rounded text-emerald-400 shadow-sm mt-1 border border-white/10">Tracking Code: <span className="font-mono text-base tracking-widest">{g.guideCode}</span></span>
                       ) : (
                         <span className="text-xs italic text-emerald-500 mt-1">Tracking code pending...</span>
                       )}
                     </div>
                  ) : (
                    <button 
                      onClick={() => handleBookGuide(g)}
                      className="w-full text-center bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-extrabold py-3.5 rounded-xl shadow-[0_0_15px_rgba(34,211,238,0.3)] hover:shadow-[0_0_25px_rgba(34,211,238,0.5)] transition-all hover:-translate-y-0.5 border border-cyan-400/30"
                    >
                      Book This Guide
                    </button>
                  )}
                  
                  <button 
                    onClick={() => handleToggleReviews(g)}
                    className="w-full mt-2 text-center text-cyan-400 font-bold py-2 underline hover:text-cyan-300 transition"
                  >
                    {expandedGuideId === g.id ? 'Close Reviews' : 'View Reviews & Ratings'}
                  </button>
                </div>
                
                {/* Advanced Reviews Toggle System */}
                {expandedGuideId === g.id && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-6 border-t border-white/10 pt-6">
                    <h4 className="font-extrabold text-white mb-4 tracking-tight">Public Log Reviews</h4>
                    
                    {/* Add Review Panel */}
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-white/10 mb-6 shadow-inner">
                      <div className="flex items-center gap-3 mb-3">
                        <label className="font-bold text-sm text-cyan-300">Your Rating:</label>
                        <select className="glass-input px-2 py-1 rounded font-bold appearance-none pr-8" value={reviewRating} onChange={e => setReviewRating(e.target.value)}>
                          <option value="5" className="bg-slate-900">⭐⭐⭐⭐⭐ (5)</option>
                          <option value="4" className="bg-slate-900">⭐⭐⭐⭐ (4)</option>
                          <option value="3" className="bg-slate-900">⭐⭐⭐ (3)</option>
                          <option value="2" className="bg-slate-900">⭐⭐ (2)</option>
                          <option value="1" className="bg-slate-900">⭐ (1)</option>
                        </select>
                      </div>
                      <textarea 
                        className="glass-input w-full p-3 rounded-lg"
                        rows="2"
                        placeholder="Write a detailed evaluation..."
                        value={reviewText}
                        onChange={e => setReviewText(e.target.value)}
                      ></textarea>
                      <button onClick={() => submitReview(g)} className="mt-3 w-full bg-cyan-600/80 backdrop-blur-md text-white border border-cyan-400/50 font-bold py-2 rounded-lg hover:bg-cyan-500 transition shadow">Deploy Feedback</button>
                    </div>
                    
                    {/* Render Prev Reviews */}
                    {loadingReviews ? (
                       <p className="text-center text-xs font-bold text-slate-500 animate-pulse">Syncing log files...</p>
                    ) : guideReviews.length === 0 ? (
                       <p className="text-center text-xs font-medium text-slate-500 bg-slate-900/30 py-4 rounded border border-white/5">No telemetry logs exist for this guide.</p>
                    ) : (
                       <div className="flex flex-col gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                         {guideReviews.map(r => (
                           <div key={r.id} className="bg-slate-900/50 border border-white/10 p-4 rounded-xl">
                             <div className="flex justify-between items-center mb-2">
                               <span className="font-bold text-sm text-white truncate pr-2">{r.touristName}</span>
                               <span className="text-yellow-300 font-bold text-xs bg-yellow-900/30 border border-yellow-500/30 px-2 py-0.5 rounded shadow-sm">★ {r.rating}</span>
                             </div>
                             <p className="text-xs text-slate-300 leading-relaxed font-medium">{r.comment}</p>
                             <div className="mt-3 text-[9px] font-bold uppercase text-slate-500">{new Date(r.createdAt).toLocaleDateString()}</div>
                           </div>
                         ))}
                       </div>
                    )}
                  </motion.div>
                )}
                
              </motion.div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default Guides;

import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, query, where, addDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const Guides = () => {
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [filterLang, setFilterLang] = useState('');
  const [filterExp, setFilterExp] = useState('');
  const [priceRange, setPriceRange] = useState(''); 

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
    const fetchGuidesAndBookings = async () => {
      setLoading(true);
      try {
        const querySnapshot = await getDocs(collection(db, "guides"));
        const guidesList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setGuides(guidesList);

        if (auth.currentUser) {
           const bQ = query(collection(db, 'bookings'), where('touristId', '==', auth.currentUser.uid));
           const bSnap = await getDocs(bQ);
           const statuses = {};
           bSnap.docs.forEach(d => {
              const bData = d.data();
              // Bug fix: only lock the guide card for active (non-rejected) bookings.
              // Rejected bookings must allow tourist to rebook.
              if (bData.status === 'requested' || bData.status === 'accepted') {
                 statuses[bData.guideId] = bData.status;
              }
              // If rejected, explicitly make sure it's NOT in statuses (allow rebooking)
           });
           setBookingStatus(statuses);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchGuidesAndBookings();
  }, []);

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

    let localTourist = null;
    try { localTourist = JSON.parse(localStorage.getItem('user')); } catch(e) {}

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
      touristName: localTourist?.name || auth.currentUser.email,
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

    let localTourist = null;
    try {
      localTourist = JSON.parse(localStorage.getItem('user'));
    } catch(e) {}

    try {
       const newReview = {
         guideId: guide.id,
         userId: auth.currentUser.uid,
         touristName: localTourist?.name || auth.currentUser.email,
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
    return match;
  });

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-8">
      <div className="bg-gradient-to-r from-blue-700 to-blue-900 text-white p-10 rounded-3xl shadow-xl border border-blue-500 overflow-hidden relative">
        <div className="absolute top-0 right-0 opacity-10 text-[180px] leading-none transform translate-x-12 -translate-y-8 pointer-events-none">📍</div>
        <h2 className="text-5xl font-extrabold mb-4 tracking-tight relative z-10">Discover Local Guides</h2>
        <p className="text-blue-100 font-medium text-xl max-w-2xl relative z-10">Find the perfect companion offering unique local experiences suited specifically to your requests.</p>
        
        {/* Strict Filters Layer */}
        <div className="flex flex-col md:flex-row gap-5 mt-10 bg-white/10 p-6 rounded-2xl border border-white/20 backdrop-blur-md relative z-10">
          <div className="w-full md:w-1/3">
            <label className="block text-sm font-bold text-blue-100 mb-2 uppercase tracking-wider">Language Match</label>
            <input type="text" placeholder="e.g. English" className="w-full px-5 py-3 border-none rounded-xl text-gray-900 focus:ring-4 focus:ring-blue-400 font-bold shadow-inner outline-none transition" value={filterLang} onChange={(e) => setFilterLang(e.target.value)} />
          </div>
          <div className="w-full md:w-1/3">
            <label className="block text-sm font-bold text-blue-100 mb-2 uppercase tracking-wider">Min Experience</label>
            <input type="number" placeholder="Years (0)" min="0" className="w-full px-5 py-3 border-none rounded-xl text-gray-900 focus:ring-4 focus:ring-blue-400 font-bold shadow-inner outline-none transition" value={filterExp} onChange={(e) => setFilterExp(e.target.value)} />
          </div>
          <div className="w-full md:w-1/3">
            <label className="block text-sm font-bold text-blue-100 mb-2 uppercase tracking-wider">Max Price / Day</label>
            <input type="number" placeholder="$ Any" min="0" className="w-full px-5 py-3 border-none rounded-xl text-gray-900 focus:ring-4 focus:ring-blue-400 font-bold shadow-inner outline-none transition" value={priceRange} onChange={(e) => setPriceRange(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="w-full">
        {loading ? (
          <div className="text-center text-gray-400 py-20 text-xl font-bold bg-white rounded-3xl shadow-sm border border-gray-100">Syncing with Firestore Network...</div>
        ) : filteredGuides.length === 0 ? (
          <div className="text-center text-gray-500 py-24 bg-white rounded-3xl border-2 border-dashed border-gray-300 shadow-sm text-xl font-bold">Terminal Output: No guides found matching parameters.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredGuides.map(g => (
              <div key={g.id} className="border border-gray-100 p-8 rounded-3xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white relative overflow-hidden group flex flex-col">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 transform origin-left transition-transform group-hover:scale-x-100"></div>
                
                <div className="flex justify-between items-start mb-6">
                  <div>
                     <h3 className="font-extrabold text-3xl text-gray-900 truncate tracking-tight">{g.name}</h3>
                     <div className="flex items-center gap-2 mt-1.5">
                       <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded shadow-sm flex items-center gap-1 ${g.status === 'Busy' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                         <span className={`w-1.5 h-1.5 rounded-full ${g.status === 'Busy' ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`}></span>
                         {g.status === 'Busy' ? 'Busy' : 'Available'}
                       </span>
                       <span className="text-sm text-gray-500 font-bold uppercase tracking-widest">{g.totalReviews || 0} Global Reviews</span>
                     </div>
                  </div>
                  <span className="bg-yellow-100 text-yellow-800 text-sm font-black px-4 py-1.5 rounded-full flex items-center shadow-sm">
                    ★ {g.rating || 0}
                  </span>
                </div>
                
                <div className="text-gray-600 space-y-4 text-sm mb-8 bg-gray-50 p-5 rounded-2xl border border-gray-100">
                  <p className="flex justify-between items-center"><strong className="text-gray-500 uppercase text-[11px] tracking-widest font-bold">Languages</strong> <span className="font-extrabold text-blue-900">{Array.isArray(g.languages) ? g.languages.join(', ') : g.languages}</span></p>
                  <p className="flex justify-between items-center"><strong className="text-gray-500 uppercase text-[11px] tracking-widest font-bold">Experience</strong> <span className="font-extrabold text-gray-800">{g.experience} Years</span></p>
                  <p className="flex justify-between items-center"><strong className="text-gray-500 uppercase text-[11px] tracking-widest font-bold">Rate/Day</strong> <span className="font-black text-green-800 bg-green-100 px-3 py-1 rounded-lg border border-green-200">${g.price}</span></p>
                </div>
                
                <div className="flex flex-col gap-3 mt-auto">
                  {/* Contact button: shows phone inline OR opens tel: — no routing bug */}
                  {shownPhone[g.id] ? (
                    <div className="w-full flex items-center justify-between bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
                      <span className="font-extrabold text-gray-800 tracking-wide">{g.phone}</span>
                      <div className="flex gap-2">
                        <a
                          href={`tel:${g.phone}`}
                          className="bg-green-600 text-white text-sm font-bold px-3 py-1.5 rounded-lg hover:bg-green-700 transition"
                          onClick={(e) => e.stopPropagation()}
                        >
                          📞 Call
                        </a>
                        <button
                          onClick={() => setShownPhone(prev => ({ ...prev, [g.id]: false }))}
                          className="text-gray-400 hover:text-gray-600 text-sm font-bold px-2"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShownPhone(prev => ({ ...prev, [g.id]: true }))}
                      className="w-full text-center bg-gray-100 text-gray-800 font-extrabold py-3.5 rounded-xl border border-gray-200 hover:bg-gray-200 hover:text-gray-900 transition-colors shadow-sm"
                    >
                      📞 Show Contact
                    </button>
                  )}

                  {/* Inline booking feedback (replaces alert) */}
                  {bookingFeedback[g.id] && (
                    <div className={`text-sm font-bold px-4 py-2 rounded-xl border ${
                      bookingFeedback[g.id].type === 'success'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {bookingFeedback[g.id].type === 'success' ? '✓' : '⚠️'} {bookingFeedback[g.id].msg}
                    </div>
                  )}

                  {g.status === 'Busy' ? (
                     <button disabled className="w-full text-center bg-gray-100 text-gray-400 font-extrabold py-3.5 rounded-xl cursor-not-allowed border border-gray-200">
                       Guide Currently Unavailable
                     </button>
                  ) : bookingStatus[g.id] === 'requested' ? (
                     <button disabled className="w-full text-center bg-yellow-100 text-yellow-700 font-extrabold py-3.5 rounded-xl cursor-not-allowed border border-yellow-200">
                       ⏳ Booking Request Pending...
                     </button>
                  ) : bookingStatus[g.id] === 'accepted' ? (
                     <button disabled className="w-full text-center bg-emerald-100 text-emerald-700 font-extrabold py-3.5 rounded-xl cursor-not-allowed border border-emerald-200">
                       Guide Booked & Accepted ✓
                     </button>
                  ) : (
                    <button 
                      onClick={() => handleBookGuide(g)}
                      className="w-full text-center bg-blue-600 text-white font-extrabold py-3.5 rounded-xl shadow-md hover:bg-blue-700 hover:shadow-lg transition-all"
                    >
                      Book This Guide
                    </button>
                  )}
                  
                  <button 
                    onClick={() => handleToggleReviews(g)}
                    className="w-full mt-2 text-center text-blue-600 font-bold py-2 underline hover:text-blue-800 transition"
                  >
                    {expandedGuideId === g.id ? 'Close Reviews' : 'View Reviews & Ratings'}
                  </button>
                </div>
                
                {/* Advanced Reviews Toggle System */}
                {expandedGuideId === g.id && (
                  <div className="mt-6 border-t border-gray-200 pt-6 animate-fade-in-up">
                    <h4 className="font-extrabold text-gray-800 mb-4 tracking-tight">Public Log Reviews</h4>
                    
                    {/* Add Review Panel */}
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-6 shadow-inner">
                      <div className="flex items-center gap-3 mb-3">
                        <label className="font-bold text-sm text-blue-900">Your Rating:</label>
                        <select className="bg-white border border-blue-200 px-2 py-1 rounded font-bold outline-none focus:ring-2 focus:ring-blue-400" value={reviewRating} onChange={e => setReviewRating(e.target.value)}>
                          <option value="5">⭐⭐⭐⭐⭐ (5)</option>
                          <option value="4">⭐⭐⭐⭐ (4)</option>
                          <option value="3">⭐⭐⭐ (3)</option>
                          <option value="2">⭐⭐ (2)</option>
                          <option value="1">⭐ (1)</option>
                        </select>
                      </div>
                      <textarea 
                        className="w-full p-3 rounded-lg border border-blue-200 outline-none focus:ring-2 focus:ring-blue-400 shadow-sm font-medium text-sm text-gray-800"
                        rows="2"
                        placeholder="Write a detailed evaluation..."
                        value={reviewText}
                        onChange={e => setReviewText(e.target.value)}
                      ></textarea>
                      <button onClick={() => submitReview(g)} className="mt-3 w-full bg-blue-800 text-white font-bold py-2 rounded-lg hover:bg-blue-900 transition shadow">Deploy Feedback</button>
                    </div>
                    
                    {/* Render Prev Reviews */}
                    {loadingReviews ? (
                       <p className="text-center text-xs font-bold text-gray-400 animate-pulse">Syncing log files...</p>
                    ) : guideReviews.length === 0 ? (
                       <p className="text-center text-xs font-medium text-gray-400 bg-gray-50 py-4 rounded border border-gray-100">No telemetry logs exist for this guide.</p>
                    ) : (
                       <div className="flex flex-col gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                         {guideReviews.map(r => (
                           <div key={r.id} className="bg-gray-50 border border-gray-100 p-4 rounded-xl">
                             <div className="flex justify-between items-center mb-2">
                               <span className="font-bold text-sm text-gray-900 truncate pr-2">{r.touristName}</span>
                               <span className="text-yellow-600 font-bold text-xs bg-yellow-100 px-2 py-0.5 rounded shadow-sm">★ {r.rating}</span>
                             </div>
                             <p className="text-xs text-gray-600 leading-relaxed font-medium">{r.comment}</p>
                             <div className="mt-3 text-[9px] font-bold uppercase text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</div>
                           </div>
                         ))}
                       </div>
                    )}
                  </div>
                )}
                
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default Guides;

import React, { useState, useEffect, useRef } from 'react';
import RoleHeader from './RoleHeader';
import { auth, db } from '../firebase';
import { collection, doc, getDoc, getDocs, setDoc, onSnapshot, updateDoc, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
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

const GuideDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');

  const [formData, setFormData] = useState({
    name: '', phone: '', languages: '', experience: '', price: '', rating: 0, totalReviews: 0, status: 'Available', city: '', state: ''
  });
  const [formSuccess, setFormSuccess] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);

  // Guide specific states
  const [guideCode, setGuideCode] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const watchIdRef = useRef(null);

  // Tracking state
  const [trackingTouristId, setTrackingTouristId] = useState(null);
  const [touristLocation, setTouristLocation] = useState(null);
  const [touristLastUpdated, setTouristLastUpdated] = useState('');

  useEffect(() => {
    let unsubBookings = () => {};

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubBookings) unsubBookings();
      
      if (!user) {
        setLoading(false);
        setRequestsLoading(false);
        return;
      }

      getDoc(doc(db, 'guides', user.uid))
        .then(async (guideDoc) => {
          if (guideDoc.exists()) {
            const data = guideDoc.data();
            setFormData(data);
            if (data.guideCode) {
              setGuideCode(data.guideCode);
            } else {
              let newCode = 'GD' + Math.floor(1000 + Math.random() * 9000);
              await updateDoc(doc(db, 'guides', user.uid), { guideCode: newCode });
              setGuideCode(newCode);
            }
          }
        })
        .catch((err) => console.error('Profile fetch error:', err))
        .finally(() => {
           console.log("Guide data fetched");
           setLoading(false);
        });

      const q = query(collection(db, 'bookings'), where('guideId', '==', user.uid));
      unsubBookings = onSnapshot(
        q,
        async (snapshot) => {
          const reqs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          
          const enhancedReqs = await Promise.all(reqs.map(async (req) => {
             let touristPhone = null;
             let touristEmail = null;
             try {
                const userDoc = await getDoc(doc(db, 'users', req.touristId));
                if (userDoc.exists()) {
                   touristPhone = userDoc.data().phone || null;
                   touristEmail = userDoc.data().email || null;
                }
             } catch (err) {}

             let finalCity = req.tripCity;
             let finalDays = req.tripDays;
             let finalPlaces = req.tripPlaces;
             let finalItin = req.tripItinerary;

             if (!finalCity) {
                try {
                  const tripsQ = query(collection(db, 'trips'), where('userId', '==', req.touristId));
                  const tripsSnap = await getDocs(tripsQ);
                  if (!tripsSnap.empty) {
                     const tripsData = tripsSnap.docs.map(d => d.data()).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
                     const latestTrip = tripsData[0];
                     finalCity = latestTrip.city;
                     finalDays = latestTrip.days;
                     finalPlaces = latestTrip.places;
                     finalItin = latestTrip.itinerary;
                  }
                } catch(err) {}
             }

             return { ...req, touristPhone, touristEmail, tripCity: finalCity, tripDays: finalDays, tripPlaces: finalPlaces, tripItinerary: finalItin };
          }));

          enhancedReqs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          setRequests(enhancedReqs);
          console.log("Guide requests fetched");
          setRequestsLoading(false);
        },
        (err) => {
          console.error('Bookings listener error:', err);
          setRequestsLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      unsubBookings();
    };
  }, []);

  // Broadcasting Effect
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    
    if (broadcasting && auth.currentUser) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          try {
            await setDoc(doc(db, 'locations', auth.currentUser.uid), {
              userId: auth.currentUser.uid,
              latitude: lat,
              longitude: lng,
              source: 'gps',
              timestamp: Date.now(),
              type: 'guide'
            }, { merge: true });
          } catch(e) {
            console.error('Location sync failed', e);
          }
        },
        (err) => console.error('Broadcasting error:', err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    } else {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    }
    
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [broadcasting]);

  useEffect(() => {
    let unsubLocation = () => {};
    if (trackingTouristId) {
      const docRef = doc(db, 'locations', trackingTouristId);
      unsubLocation = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setTouristLocation({ lat: data.latitude, lng: data.longitude });
          let formattedTime = '';
          if (data.timestamp) {
            const d = typeof data.timestamp === 'number' ? new Date(data.timestamp) : new Date(data.timestamp);
            formattedTime = isNaN(d.getTime()) ? String(data.timestamp) : d.toLocaleString();
          }
          setTouristLastUpdated(formattedTime);
        } else {
          setTouristLocation(null);
          setTouristLastUpdated('');
        }
      });
    } else {
      setTouristLocation(null);
      setTouristLastUpdated('');
    }
    return () => unsubLocation();
  }, [trackingTouristId]);

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setFormSuccess('');
    setFormError('');
    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      const dataToSave = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        languages: Array.isArray(formData.languages)
          ? formData.languages
          : formData.languages.split(',').map((s) => s.trim()).filter(Boolean),
        experience: Number(formData.experience) || 0,
        price: Number(formData.price) || 0,
        rating: formData.rating || 0,
        totalReviews: formData.totalReviews || 0,
        status: formData.status || 'Available',
        city: formData.city || '',
        state: formData.state || '',
      };

      await updateDoc(doc(db, 'guides', user.uid), dataToSave);
      setFormData(prev => ({ ...prev, ...dataToSave }));
      setFormSuccess('Profile saved successfully!');
      setTimeout(() => setFormSuccess(''), 3000);
    } catch (err) {
      console.error(err);
      setFormError('Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestStatus = async (bookingId, status) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { status });
      setRequests((prev) =>
        prev.map((req) => (req.id === bookingId ? { ...req, status } : req))
      );
    } catch (err) {
      console.error(err);
      setFormError('Failed to update booking status. Please try again.');
    }
  };

  const handleCancelRequest = async (bookingId) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { 
        status: 'guide_cancel_requested',
        cancelRequested: true
      });
      setRequests((prev) =>
        prev.map((req) => (req.id === bookingId ? { ...req, status: 'guide_cancel_requested', cancelRequested: true } : req))
      );
    } catch (err) {
      console.error(err);
      setFormError('Failed to send cancellation request. Please try again.');
    }
  };

  if (loading || requestsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="text-5xl animate-bounce">🧭</div>
        <div className="text-xl font-bold text-cyan-300 animate-pulse">
          Loading Guide Dashboard...
        </div>
      </div>
    );
  }

  if (!formData) {
    return <div className="p-12 text-center text-xl text-red-500 font-bold">No Guide Data Found</div>;
  }

  console.log("Guide auth loaded");
  console.log("Guide data:", formData);
  console.log("Guide portal rendering");

  const pendingRequests = requests.filter((r) => r.status === 'requested');
  const activeTrips = requests.filter((r) => r.status === 'accepted' || r.status === 'guide_cancel_requested');

  const pendingCount = pendingRequests.length;

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6 text-slate-200">
      <RoleHeader role="guide" />
      {/* Header */}
      <div className="glass-panel p-8 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all">
        <div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">Guide Portal</h2>
          <p className="text-blue-600 font-bold mt-2 text-lg flex items-center gap-2">
            <span className="bg-blue-100 px-3 py-1 rounded-full text-sm">⭐ {formData.rating || 0} Rating</span>
            <span className="bg-blue-100 px-3 py-1 rounded-full text-sm">{formData.totalReviews || 0} Reviews</span>
            {guideCode && (
              <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-mono tracking-widest shadow-sm">
                Code: {guideCode}
              </span>
            )}
          </p>
          <div className="mt-4">
             <button
               onClick={() => setBroadcasting(!broadcasting)}
               className={`px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all flex items-center gap-2 ${broadcasting ? 'bg-red-500 text-white animate-pulse shadow-red-200' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'}`}
             >
               {broadcasting ? '🛑 Stop Broadcasting Location' : '📡 Start Broadcasting Location'}
             </button>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 bg-slate-900/50 backdrop-blur-md p-1.5 rounded-xl border border-white/10 mt-4 md:mt-0">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-5 py-2.5 rounded-lg font-bold transition-all ${activeTab === 'profile' ? 'bg-white/10 shadow-sm text-cyan-400 border border-white/10' : 'text-slate-400 hover:text-slate-200'}`}
          >
            My Profile
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all ${activeTab === 'requests' ? 'bg-white/10 shadow-sm text-cyan-400 border border-white/10' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Requests
            {pendingCount > 0 && (
              <span className="bg-red-500/80 text-white text-[11px] px-2 py-0.5 rounded-full shadow-sm">
                {pendingCount} NEW
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('active')}
            className={`px-5 py-2.5 rounded-lg font-bold transition-all ${activeTab === 'active' ? 'bg-white/10 shadow-sm text-cyan-400 border border-white/10' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Active Trips
          </button>
        </div>
      </div>

      {/* Inline error banner (shared) */}
      {formError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-3 rounded-xl font-bold flex items-center gap-3">
          <span>⚠️</span> {formError}
          <button onClick={() => setFormError('')} className="ml-auto text-red-400 hover:text-red-600 font-black">✕</button>
        </div>
      )}

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="glass-panel p-8 rounded-2xl transition-all">
          <h3 className="text-2xl font-bold text-white mb-6 tracking-tight">Edit Public Profile</h3>

          {formSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl mb-6 font-bold flex items-center gap-2">
              ✓ {formSuccess}
            </div>
          )}

          <form onSubmit={handleProfileSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Display Name</label>
              <input
                type="text"
                required
                className="glass-input w-full px-4 py-3 rounded-xl"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Phone Number</label>
              <input
                type="tel"
                required
                placeholder="+91XXXXXXXXXX"
                className="glass-input w-full px-4 py-3 rounded-xl"
                value={formData.phone || ''}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Languages (comma separated)</label>
              <input
                type="text"
                required
                placeholder="English, Hindi, Spanish"
                className="glass-input w-full px-4 py-3 rounded-xl"
                value={Array.isArray(formData.languages) ? formData.languages.join(', ') : formData.languages || ''}
                onChange={(e) => setFormData({ ...formData, languages: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Experience (Years)</label>
              <input
                type="number"
                required
                min="0"
                className="glass-input w-full px-4 py-3 rounded-xl"
                value={formData.experience || ''}
                onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Operating City</label>
              <input
                type="text"
                required
                placeholder="e.g. Mumbai"
                className="glass-input w-full px-4 py-3 rounded-xl"
                value={formData.city || ''}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Operating State</label>
              <input
                type="text"
                required
                placeholder="e.g. Maharashtra"
                className="glass-input w-full px-4 py-3 rounded-xl"
                value={formData.state || ''}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Price per Day (₹)</label>
              <input
                type="number"
                required
                min="0"
                placeholder="500"
                className="glass-input w-full px-4 py-3 rounded-xl"
                value={formData.price || ''}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Availability Status</label>
              <div className="relative">
                <select
                  className="glass-input w-full px-4 py-3 rounded-xl appearance-none"
                  value={formData.status || 'Available'}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="Available" className="bg-slate-900">🟢 Available for Booking</option>
                  <option value="Busy" className="bg-slate-900">🔴 Currently Busy</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="md:col-span-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className={`px-8 py-3.5 rounded-xl font-bold shadow-md transition-all text-lg md:w-auto w-full ${
                  saving
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Requests Tab */}
      {activeTab === 'requests' && (
        <div className="bg-white/10 backdrop-blur-xl p-8 rounded-2xl shadow-md border border-white/10 relative z-10 transition-all">
          <h3 className="text-2xl font-bold text-gray-800 mb-6 tracking-tight">Pending Requests</h3>

          {requestsLoading ? (
            <div className="text-center py-16 text-gray-400 font-bold animate-pulse">
              Loading requests...
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="text-gray-500 bg-gray-50 p-10 rounded-xl text-center border border-dashed border-gray-300 font-medium text-lg">
              No pending booking requests.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {pendingRequests.map((req) => (
                <div key={req.id} className="border border-gray-200 p-6 rounded-2xl bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center shadow-sm hover:shadow-md transition">
                  <div className="mb-4 md:mb-0 w-full pr-4">
                    <p className="font-extrabold text-xl text-gray-900 border-b border-gray-200 pb-2 mb-3">
                      <span className="text-blue-600 mr-2">📌</span>
                      {req.touristName || 'A tourist'} requested your services
                    </p>

                    {req.tripCity && (
                      <div className="mb-4 bg-teal-50 p-4 rounded-xl border border-teal-100 shadow-inner w-full md:w-3/4">
                        <h4 className="font-black text-teal-800 text-sm tracking-tight mb-2 flex items-center gap-2">
                          🗺️ Planned Route: {req.tripCity} {req.tripDays && <span className="text-[10px] bg-teal-600 text-white px-2 py-0.5 rounded-full ml-1">{req.tripDays} Days</span>}
                        </h4>
                        
                        {req.tripItinerary ? (
                          <div className="space-y-3">
                            {req.tripItinerary?.map((day, dIdx) => (
                              <div key={dIdx}>
                                <p className="text-[10px] font-black uppercase tracking-wider text-teal-600 mb-1">Day {day.day}</p>
                                <ul className="list-disc list-inside text-xs font-bold text-teal-900 ml-2">
                                  {day.places?.map((p, pIdx) => (
                                    <li key={pIdx} className="truncate">{p.name || p}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        ) : req.tripPlaces && req.tripPlaces.length > 0 ? (
                          <ol className="list-decimal list-inside text-sm font-bold text-teal-900 space-y-1">
                            {req.tripPlaces?.map((p, idx) => (
                              <li key={idx} className="truncate">{p.name || p}</li>
                            ))}
                          </ol>
                        ) : (
                          <span className="text-xs font-bold text-teal-600/70">No specific places assigned.</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 w-full md:w-auto flex-shrink-0 mt-4 md:mt-0">
                    <button
                      onClick={() => handleRequestStatus(req.id, 'accepted')}
                      className="flex-1 md:flex-none bg-green-500 hover:bg-green-600 text-white font-bold px-6 py-3 rounded-xl shadow transition"
                    >
                      ✓ Accept
                    </button>
                    <button
                      onClick={() => handleRequestStatus(req.id, 'rejected')}
                      className="flex-1 md:flex-none bg-red-500 hover:bg-red-600 text-white font-bold px-6 py-3 rounded-xl shadow transition"
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Trips Tab */}
      {activeTab === 'active' && (
        <div className="bg-white/10 backdrop-blur-xl p-8 rounded-2xl shadow-md border border-white/10 relative z-10 transition-all">
          <h3 className="text-2xl font-bold text-gray-800 mb-6 tracking-tight">Active Trips & Tracking</h3>

          {activeTrips.length === 0 ? (
            <div className="text-gray-500 bg-gray-50 p-10 rounded-xl text-center border border-dashed border-gray-300 font-medium text-lg">
              No active trips.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {activeTrips.map((req) => (
                <div key={req.id} className="flex flex-col gap-2">
                  <div className="border border-green-200 p-6 rounded-2xl bg-green-50/30 flex flex-col md:flex-row justify-between items-start md:items-center shadow-sm">
                    <div className="mb-4 md:mb-0 w-full pr-4">
                      <p className="font-extrabold text-xl text-green-900 border-b border-green-200 pb-2 mb-3">
                        <span className="text-green-600 mr-2">🟢</span>
                        Tour with {req.touristName || 'Tourist'}
                      </p>
                      {(req.touristEmail || req.touristPhone) && (
                        <div className="text-sm font-bold text-gray-600 mb-4 bg-white/50 inline-block px-4 py-2 rounded-lg border border-green-100">
                          {req.touristEmail && <span className="mr-4">✉️ {req.touristEmail}</span>}
                          {req.touristPhone && <span>📞 {req.touristPhone}</span>}
                        </div>
                      )}

                      {req.tripCity && (
                        <div className="mb-4 bg-white p-4 rounded-xl border border-green-100 shadow-sm w-full md:w-3/4">
                          <h4 className="font-black text-green-800 text-sm tracking-tight mb-2 flex items-center gap-2">
                            🗺️ Itinerary: {req.tripCity} {req.tripDays && <span className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded-full ml-1">{req.tripDays} Days</span>}
                          </h4>
                          
                          {req.tripItinerary ? (
                            <div className="space-y-3">
                              {req.tripItinerary?.map((day, dIdx) => (
                                <div key={dIdx}>
                                  <p className="text-[10px] font-black uppercase tracking-wider text-green-600 mb-1">Day {day.day}</p>
                                  <ul className="list-disc list-inside text-xs font-bold text-green-900 ml-2">
                                    {day.places?.map((p, pIdx) => (
                                      <li key={pIdx} className="truncate">{p.name || p}</li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs font-bold text-green-600/70">Flexible itinerary.</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 w-full md:w-auto flex-shrink-0 mt-4 md:mt-0">
                      <button
                        onClick={() => setTrackingTouristId(trackingTouristId === req.touristId ? null : req.touristId)}
                        className={`w-full md:w-auto font-bold px-6 py-3 rounded-xl shadow transition ${
                          trackingTouristId === req.touristId
                            ? 'bg-blue-100 text-blue-700 border border-blue-200'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {trackingTouristId === req.touristId ? 'Hide Map' : '🛰️ Track Tourist'}
                      </button>
                      
                      {req.status === 'guide_cancel_requested' ? (
                        <button
                          disabled
                          className="w-full md:w-auto font-bold px-6 py-3 rounded-xl shadow transition bg-yellow-100 text-yellow-700 border border-yellow-200 cursor-not-allowed"
                        >
                          ⏳ Pending Cancellation Approval
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleRequestStatus(req.id, 'completed')}
                            className="w-full md:w-auto font-bold px-6 py-3 rounded-xl shadow transition bg-gray-800 hover:bg-gray-900 text-white"
                          >
                            🏁 Complete Trip
                          </button>
                          <button
                            onClick={() => handleCancelRequest(req.id)}
                            className="w-full md:w-auto font-bold px-6 py-3 rounded-xl shadow transition bg-red-100 hover:bg-red-200 text-red-700 border border-red-200"
                          >
                            ✕ Cancel Tour
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inline Map for Tracked Tourist */}
                  {trackingTouristId === req.touristId && (
                    <div className="mt-2 bg-white p-3 rounded-2xl border border-blue-200 shadow-sm relative z-0">
                       <div className="flex justify-between items-center bg-blue-50 px-4 py-2 rounded-t-xl mb-2">
                         <h4 className="font-black text-blue-900 flex items-center gap-2">
                           <span className="animate-pulse text-red-500">🔴</span> Live GPS Feed: {req.touristName}
                         </h4>
                         {touristLastUpdated && <span className="text-xs font-bold text-slate-500">Updated: {touristLastUpdated}</span>}
                       </div>
                       <div className="h-[400px] w-full rounded-xl overflow-hidden relative">
                         <MapContainer
                           center={touristLocation?.lat ? [touristLocation.lat, touristLocation.lng] : [17.3850, 78.4867]}
                           zoom={touristLocation?.lat ? 16 : 5}
                           style={{ height: '100%', width: '100%' }}
                           className="z-0"
                         >
                           <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                           {touristLocation && (
                             <>
                               <Marker position={[touristLocation.lat, touristLocation.lng]}>
                                 <Popup>
                                   <div className="font-bold text-center text-blue-900">
                                     📍 {req.touristName} is here
                                   </div>
                                 </Popup>
                               </Marker>
                               <RecenterMap lat={touristLocation.lat} lng={touristLocation.lng} />
                             </>
                           )}
                         </MapContainer>
                         {!touristLocation && (
                           <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-bold bg-gray-50/80 z-[1000] border-2 border-dashed border-gray-200 rounded-xl">
                             Waiting for tourist's GPS signal...
                           </div>
                         )}
                       </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GuideDashboard;

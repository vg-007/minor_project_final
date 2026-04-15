import React, { useState, useEffect } from 'react';
import { collection, doc, getDoc, setDoc, onSnapshot, updateDoc, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
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
    name: '', phone: '', languages: '', experience: '', price: '', rating: 0, totalReviews: 0, status: 'Available'
  });
  const [formSuccess, setFormSuccess] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);

  // Tracking state
  const [trackingTouristId, setTrackingTouristId] = useState(null);
  const [touristLocation, setTouristLocation] = useState(null);
  const [touristLastUpdated, setTouristLastUpdated] = useState('');

  useEffect(() => {
    let unsubBookings = () => {};

    // Bug fix: wait for Firebase Auth to resolve before reading currentUser
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubBookings) unsubBookings(); // Cleanup previous listener if auth state changes
      
      if (!user) {
        setLoading(false);
        setRequestsLoading(false);
        return;
      }

      // Fetch guide profile (one-time)
      getDoc(doc(db, 'guides', user.uid))
        .then((guideDoc) => {
          if (guideDoc.exists()) setFormData(guideDoc.data());
        })
        .catch((err) => console.error('Profile fetch error:', err))
        .finally(() => setLoading(false));

      // Real-time listener for incoming bookings — sorted newest first
      const q = query(collection(db, 'bookings'), where('guideId', '==', user.uid));
      unsubBookings = onSnapshot(
        q,
        (snapshot) => {
          const reqs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          reqs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          setRequests(reqs);
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

  // Real-time listener for the currently tracked tourist's location
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
      };

      await setDoc(doc(db, 'guides', user.uid), dataToSave);
      setFormData(dataToSave);
      setFormSuccess('Profile saved successfully!');
      // Auto-clear success message after 3 seconds
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
      // onSnapshot will auto-update the list; this is a local optimistic update
      setRequests((prev) =>
        prev.map((req) => (req.id === bookingId ? { ...req, status } : req))
      );
    } catch (err) {
      console.error(err);
      setFormError('Failed to update booking status. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-xl font-semibold text-gray-500 animate-pulse">
        Loading Guide Portal...
      </div>
    );
  }

  const pendingCount = requests.filter((r) => r.status === 'requested').length;

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="bg-white p-8 rounded-2xl shadow-md border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Guide Portal</h2>
          <p className="text-blue-600 font-bold mt-1 text-lg flex items-center gap-2">
            <span className="bg-blue-100 px-3 py-1 rounded-full text-sm">⭐ {formData.rating || 0} Rating</span>
            <span className="bg-blue-100 px-3 py-1 rounded-full text-sm">{formData.totalReviews || 0} Reviews</span>
          </p>
        </div>
        <div className="flex gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-200">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-5 py-2.5 rounded-lg font-bold transition-all ${activeTab === 'profile' ? 'bg-white shadow-sm text-blue-700 border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
          >
            My Profile
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all ${activeTab === 'requests' ? 'bg-white shadow-sm text-blue-700 border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Booking Requests
            {pendingCount > 0 && (
              <span className="bg-red-500 text-white text-[11px] px-2 py-0.5 rounded-full shadow-sm">
                {pendingCount} NEW
              </span>
            )}
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
        <div className="bg-white p-8 rounded-2xl shadow-md border border-gray-100">
          <h3 className="text-2xl font-bold text-gray-800 mb-6 tracking-tight">Edit Public Profile</h3>

          {formSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl mb-6 font-bold flex items-center gap-2">
              ✓ {formSuccess}
            </div>
          )}

          <form onSubmit={handleProfileSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Display Name</label>
              <input
                type="text"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Phone Number</label>
              <input
                type="tel"
                required
                placeholder="+91XXXXXXXXXX"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition"
                value={formData.phone || ''}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Languages (comma separated)</label>
              <input
                type="text"
                required
                placeholder="English, Hindi, Spanish"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition"
                value={Array.isArray(formData.languages) ? formData.languages.join(', ') : formData.languages || ''}
                onChange={(e) => setFormData({ ...formData, languages: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Experience (Years)</label>
              <input
                type="number"
                required
                min="0"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition"
                value={formData.experience || ''}
                onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Price per Day (₹)</label>
              <input
                type="number"
                required
                min="0"
                placeholder="500"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition"
                value={formData.price || ''}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Availability Status</label>
              <div className="relative">
                <select
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none appearance-none transition"
                  value={formData.status || 'Available'}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="Available">🟢 Available for Booking</option>
                  <option value="Busy">🔴 Currently Busy</option>
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
        <div className="bg-white p-8 rounded-2xl shadow-md border border-gray-100">
          <h3 className="text-2xl font-bold text-gray-800 mb-6 tracking-tight">Booking Requests</h3>

          {requestsLoading ? (
            <div className="text-center py-16 text-gray-400 font-bold animate-pulse">
              Loading requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="text-gray-500 bg-gray-50 p-10 rounded-xl text-center border border-dashed border-gray-300 font-medium text-lg">
              No booking requests yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {requests.map((req) => (
                <div key={req.id} className="flex flex-col gap-2">
                  <div
                    className="border border-gray-200 p-6 rounded-2xl bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center shadow-sm hover:shadow-md transition"
                  >
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
                            {req.tripItinerary.map((day, dIdx) => (
                              <div key={dIdx}>
                                <p className="text-[10px] font-black uppercase tracking-wider text-teal-600 mb-1">Day {day.day}</p>
                                <ul className="list-disc list-inside text-xs font-bold text-teal-900 ml-2">
                                  {day.places.map((p, pIdx) => (
                                    <li key={pIdx} className="truncate">{p.name}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        ) : req.tripPlaces && req.tripPlaces.length > 0 ? (
                          <ol className="list-decimal list-inside text-sm font-bold text-teal-900 space-y-1">
                            {req.tripPlaces.map((p, idx) => (
                              <li key={idx} className="truncate">{p.name || p}</li>
                            ))}
                          </ol>
                        ) : (
                          <span className="text-xs font-bold text-teal-600/70">No specific places assigned.</span>
                        )}
                      </div>
                    )}

                    <p className="font-bold text-sm text-gray-600">
                      <span className="uppercase text-[10px] tracking-wider text-gray-400">Status</span>
                      <br />
                      <span
                        className={`px-3 py-1 rounded inline-block mt-1 font-extrabold ${
                          req.status === 'requested'
                            ? 'bg-yellow-200 text-yellow-800'
                            : req.status === 'accepted'
                            ? 'bg-green-200 text-green-800'
                            : 'bg-red-200 text-red-800'
                        }`}
                      >
                        {req.status}
                      </span>
                    </p>
                  </div>

                  {req.status === 'requested' ? (
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
                  ) : req.status === 'accepted' ? (
                    <div className="flex w-full md:w-auto flex-shrink-0 mt-4 md:mt-0">
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
                    </div>
                  ) : null}
                </div>

                {/* Inline Map for Tracked Tourist */}
                {trackingTouristId === req.touristId && (
                  <div className="mt-4 bg-white p-3 rounded-2xl border border-blue-200 shadow-sm relative z-0">
                     <div className="flex justify-between items-center bg-blue-50 px-4 py-2 rounded-t-xl mb-2">
                       <h4 className="font-black text-blue-900 flex items-center gap-2">
                         <span className="animate-pulse text-red-500">🔴</span> Live GPS Feed: {req.touristName}
                       </h4>
                       {touristLastUpdated && <span className="text-xs font-bold text-slate-500">Updated: {touristLastUpdated}</span>}
                     </div>
                     <div className="h-[400px] w-full rounded-xl overflow-hidden relative">
                       <MapContainer
                         center={touristLocation ? [touristLocation.lat, touristLocation.lng] : [17.3850, 78.4867]}
                         zoom={touristLocation ? 16 : 5}
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

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../firebase';
import MapComponent from './MapComponent';

const Dashboard = () => {
  const [latestTrip, setLatestTrip] = useState(null);
  const [loadingTrip, setLoadingTrip] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!isMounted) return;
      if (!user) { setLoadingTrip(false); return; }
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
    });
    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  return (
    <div className="w-full max-w-7xl flex flex-col items-center gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">

      {/* Hero Banner */}
      <div className="w-full bg-gradient-to-br from-slate-900 via-teal-900 to-blue-900 p-10 rounded-[2rem] shadow-2xl shadow-teal-900/20 border border-white/10 relative overflow-hidden group">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay"></div>
        <div className="absolute -top-10 -right-10 opacity-5 text-[200px] pointer-events-none group-hover:rotate-12 group-hover:scale-110 transition-transform duration-1000 select-none">🌍</div>
        <h2 className="text-4xl md:text-5xl font-black text-white mb-4 tracking-tighter relative z-10 drop-shadow-md">
          Tourist Dashboard
        </h2>
        <p className="text-teal-100 font-medium text-lg max-w-2xl relative z-10">
          Explore your surroundings, manage your trip, and stay connected with your guardian.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 relative z-10">
          <span className="bg-white/10 backdrop-blur-md border border-white/20 text-white font-bold px-5 py-2.5 rounded-full text-sm flex items-center gap-2 shadow-inner">
            <span className="animate-bounce">📍</span> Live Map Active
          </span>
          <span className="bg-emerald-500/20 backdrop-blur-md border border-emerald-400/30 text-emerald-100 font-bold px-5 py-2.5 rounded-full text-sm flex items-center gap-2 shadow-inner">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Real-Time Tracking Ready
          </span>
        </div>
      </div>

      {/* Map */}
      <div className="w-full bg-white/80 backdrop-blur-md p-5 rounded-[2rem] shadow-xl border border-gray-100 relative z-0">
        <div className="w-full rounded-2xl overflow-hidden shadow-inner bg-slate-50 relative isolate">
          <MapComponent />
        </div>
      </div>

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

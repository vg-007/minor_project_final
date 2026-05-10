import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import Guides from './components/Guides';
import GuideDashboard from './components/GuideDashboard';
import TouristTrack from './components/TouristTrack';
import ParentDashboard from './components/ParentDashboard';
import TripPlanner from './components/TripPlanner';
import RoleSelection from './components/RoleSelection';

const App = () => {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserRole(data.role || 'tourist');
          } else {
            setUserRole('pending');
          }
        } catch (e) {
          console.error("Auth DB Sync Error:", e);
          setUserRole('pending');
        }
      } else {
        setUserRole(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <span className="text-5xl animate-bounce">🌍</span>
        <span className="text-xl font-bold text-cyan-300 animate-pulse">Loading TravelEase...</span>
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-slate-950 flex flex-col font-sans transition-colors duration-500 relative overflow-hidden text-slate-200">
        
        {/* Cinematic Background Orbs */}
        <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-600/20 blur-[150px] rounded-full pointer-events-none z-0"></div>
        <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 blur-[150px] rounded-full pointer-events-none z-0"></div>
        <div className="fixed top-[40%] left-[30%] w-[30%] h-[30%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none z-0"></div>

        {/* Navigation */}
        <nav className="glass-panel text-white sticky top-4 z-50 shadow-2xl w-[95%] max-w-7xl mx-auto rounded-3xl mt-4 border border-white/10 overflow-hidden">
          <div className="px-4 md:px-8 py-4 flex flex-col xl:flex-row justify-between items-center gap-4 relative z-10">
            <div className="flex-shrink-0 group">
              <Link to="/" className="flex items-center gap-3">
                <span className="text-3xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-fuchsia-400 drop-shadow-md group-hover:scale-105 transition-transform duration-300">
                  <span className="animate-pulse inline-block mr-1 text-white">🌍</span>
                  TravelEase
                </span>
              </Link>
            </div>

            <div className="w-full flex overflow-x-auto pb-2 items-center justify-center xl:justify-end gap-3 webkit-scrollbar-hide scroll-smooth snap-x">
              {user ? (
                <>
                  {userRole === 'tourist' && <Link to="/dashboard" className="snap-start px-5 py-2.5 rounded-2xl border border-white/5 bg-white/5 hover:bg-white/10 hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition-all duration-300 font-bold whitespace-nowrap backdrop-blur-md shadow-sm">🌐 Explore Map</Link>}
                  {userRole === 'tourist' && <Link to="/guides" className="snap-start px-5 py-2.5 rounded-2xl border border-white/5 bg-white/5 hover:bg-white/10 hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition-all duration-300 font-bold whitespace-nowrap backdrop-blur-md shadow-sm">🧑‍💼 Verified Guides</Link>}
                  {userRole === 'tourist' && <Link to="/trip-planner" className="snap-start px-5 py-2.5 rounded-2xl border border-teal-400/30 bg-gradient-to-r from-teal-500/20 to-cyan-500/20 hover:from-teal-500/30 hover:to-cyan-500/30 hover:shadow-teal-500/20 hover:-translate-y-0.5 active:scale-95 transition-all duration-300 font-extrabold text-teal-300 whitespace-nowrap backdrop-blur-md shadow-md">📋 Trip Planner</Link>}
                  {userRole === 'parent' && <Link to="/parent-dashboard" className="snap-start px-5 py-2.5 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20 hover:shadow-emerald-500/20 hover:-translate-y-0.5 active:scale-95 transition-all duration-300 font-extrabold text-emerald-300 whitespace-nowrap backdrop-blur-md shadow-md">🎯 Guardian Dashboard</Link>}
                  {userRole === 'guide' && (
                    <Link to="/guide-dashboard" className="snap-start px-6 py-2.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-yellow-900 border border-yellow-300 rounded-2xl shadow-lg hover:shadow-orange-500/30 hover:scale-105 active:scale-95 transition-all duration-300 font-black whitespace-nowrap">Guide Center</Link>
                  )}
                  <div className="snap-start flex items-center gap-3 pl-2 md:border-l md:border-white/10 ml-2">
                    <span className="font-bold hidden xl:block text-slate-300 bg-slate-800/50 px-4 py-1.5 rounded-xl border border-slate-700/50 backdrop-blur-sm">{user.email}</span>
                    <button onClick={() => signOut(auth)} className="bg-red-500/80 hover:bg-red-500 px-5 py-2.5 rounded-2xl text-white font-extrabold hover:shadow-red-500/30 hover:-translate-y-0.5 active:scale-95 transition-all duration-300 shadow-sm whitespace-nowrap border border-red-500/50">Logout</button>
                  </div>
                </>
              ) : (
                <span className="font-extrabold tracking-wide bg-gradient-to-r from-teal-500/20 to-blue-500/20 px-5 py-2.5 rounded-xl backdrop-blur-md border border-white/10 text-teal-100 flex items-center gap-2">
                  <span className="animate-pulse w-2 h-2 rounded-full bg-teal-400 inline-block"></span>
                  Next Generation Touring Engine
                </span>
              )}
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-grow w-full max-w-[1400px] mx-auto p-4 md:p-8 relative z-10">
          <Routes>
            {!user ? (
              <>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="*" element={<Navigate to="/login" replace />} />
              </>
            ) : (
              <>
                <Route path="/" element={<Navigate to={userRole === 'guide' ? '/guide-dashboard' : userRole === 'parent' ? '/parent-dashboard' : userRole === 'pending' ? '/role-selection' : '/dashboard'} replace />} />
                <Route path="/login" element={<Navigate to="/" replace />} />
                <Route path="/register" element={<Navigate to="/" replace />} />
                <Route path="/role-selection" element={userRole === 'pending' ? <RoleSelection /> : <Navigate to="/" replace />} />
                
                <Route path="/dashboard" element={userRole === 'tourist' ? <Dashboard /> : <Navigate to="/" replace />} />
                <Route path="/trip-planner" element={userRole === 'tourist' ? <TripPlanner /> : <Navigate to="/" replace />} />
                <Route path="/guides" element={userRole === 'tourist' ? <Guides /> : <Navigate to="/" replace />} />
                
                <Route path="/parent-dashboard" element={userRole === 'parent' ? <ParentDashboard /> : <Navigate to="/" replace />} />
                <Route path="/guide-dashboard" element={userRole === 'guide' ? <GuideDashboard /> : <Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;

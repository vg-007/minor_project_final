import React, { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { motion } from 'framer-motion';

const RoleSelection = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [showGuideForm, setShowGuideForm] = useState(false);
  const [guideData, setGuideData] = useState({ city: '', state: '' });

  // Protect route if no state passed
  if (!location.state || !location.state.uid) {
    return <Navigate to="/" />;
  }

  const { uid, email, name } = location.state;

  const handleRoleSelection = async (selectedRole) => {
    if (selectedRole === 'guide' && !showGuideForm) {
      setShowGuideForm(true);
      return;
    }

    if (selectedRole === 'guide' && (!guideData.city || !guideData.state)) {
      setError('Please fill out both City and State.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const userData = {
        name: name || 'Google User',
        email: email,
        role: selectedRole,
        createdAt: new Date().toISOString()
      };

      if (selectedRole === 'guide') {
        userData.city = guideData.city;
        userData.state = guideData.state;
      }

      await setDoc(doc(db, 'users', uid), userData);
      
      window.location.href = '/dashboard';
    } catch(err) {
      console.error(err);
      setError('Failed to complete setup. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full min-h-[80vh] flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md glass-panel p-8 rounded-3xl shadow-lg relative z-10 text-slate-200 mx-auto mt-10">
        <h2 className="text-3xl font-black text-center text-white mb-2">Welcome!</h2>
        <p className="text-center text-cyan-400 mb-8 font-bold tracking-wide text-sm uppercase">Please select your account type</p>
        
        {error && <div className="bg-red-900/50 text-red-300 p-3 rounded-xl border border-red-500/50 mb-4 text-sm font-bold text-center">{error}</div>}
        
        <div className="space-y-4">
          <button
            onClick={() => handleRoleSelection('tourist')}
            disabled={loading || showGuideForm}
            className={`w-full py-4 px-4 border border-cyan-500/30 rounded-xl shadow-lg text-lg font-extrabold text-cyan-300 bg-cyan-900/20 hover:bg-cyan-900/40 hover:-translate-y-1 transition-all ${(loading || showGuideForm) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            🗺️ Continue as Tourist
          </button>
          
          {!showGuideForm ? (
            <button
              onClick={() => handleRoleSelection('guide')}
              disabled={loading}
              className={`w-full py-4 px-4 border border-indigo-500/30 rounded-xl shadow-lg text-lg font-extrabold text-indigo-300 bg-indigo-900/20 hover:bg-indigo-900/40 hover:-translate-y-1 transition-all ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              🧑‍💼 Continue as Guide
            </button>
          ) : (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-slate-900/50 p-5 rounded-xl border border-indigo-500/30">
              <h3 className="font-bold text-indigo-300 mb-3 text-sm uppercase tracking-wider">Guide Operating Location</h3>
              <div className="space-y-3 mb-4">
                <input 
                  type="text" 
                  placeholder="City (e.g. Mumbai)" 
                  className="glass-input w-full p-3 rounded-lg"
                  value={guideData.city}
                  onChange={e => setGuideData({...guideData, city: e.target.value})}
                />
                <input 
                  type="text" 
                  placeholder="State (e.g. Maharashtra)" 
                  className="glass-input w-full p-3 rounded-lg"
                  value={guideData.state}
                  onChange={e => setGuideData({...guideData, state: e.target.value})}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowGuideForm(false)} className="px-4 py-2 text-indigo-300 font-bold hover:bg-white/10 rounded-lg border border-transparent hover:border-white/10 transition w-1/3">Back</button>
                <button onClick={() => handleRoleSelection('guide')} disabled={loading} className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold rounded-lg hover:from-indigo-500 hover:to-blue-500 transition shadow-lg w-2/3">Finish Setup</button>
              </div>
            </motion.div>
          )}

          <button
            onClick={() => handleRoleSelection('parent')}
            disabled={loading || showGuideForm}
            className={`w-full py-4 px-4 border border-emerald-500/30 rounded-xl shadow-lg text-lg font-extrabold text-emerald-300 bg-emerald-900/20 hover:bg-emerald-900/40 hover:-translate-y-1 transition-all ${(loading || showGuideForm) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            🛡️ Continue as Guardian
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default RoleSelection;

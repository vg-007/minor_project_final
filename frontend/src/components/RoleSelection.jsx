import React, { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const RoleSelection = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Protect route if no state passed
  if (!location.state || !location.state.uid) {
    return <Navigate to="/" />;
  }

  const { uid, email, name } = location.state;

  const handleRoleSelection = async (selectedRole) => {
    setLoading(true);
    setError('');
    try {
      const userData = {
        name: name || 'Google User',
        email: email,
        role: selectedRole,
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'users', uid), userData);
      localStorage.setItem('user', JSON.stringify({ uid, ...userData }));
      
      // Force page reload so App.jsx pulls the new role instead of being stuck in 'pending'
      window.location.href = '/dashboard';
    } catch(err) {
      console.error(err);
      setError('Failed to complete setup. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg border border-gray-100 mx-auto mt-10">
      <h2 className="text-3xl font-black text-center text-gray-900 mb-2">Welcome!</h2>
      <p className="text-center text-gray-500 mb-8 font-medium">Please select your account type to continue.</p>
      
      {error && <div className="bg-red-50 text-red-600 p-3 rounded-md mb-4 text-sm font-medium">{error}</div>}
      
      <div className="space-y-4">
        <button
          onClick={() => handleRoleSelection('tourist')}
          disabled={loading}
          className={`w-full py-4 px-4 border border-blue-200 rounded-xl shadow-sm text-lg font-bold text-blue-800 bg-blue-50 hover:bg-blue-100 transition-colors ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          🗺️ Continue as Tourist
        </button>
        
        <button
          onClick={() => handleRoleSelection('guide')}
          disabled={loading}
          className={`w-full py-4 px-4 border border-indigo-200 rounded-xl shadow-sm text-lg font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 transition-colors ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          🧑‍💼 Continue as Guide
        </button>

        <button
          onClick={() => handleRoleSelection('parent')}
          disabled={loading}
          className={`w-full py-4 px-4 border border-emerald-200 rounded-xl shadow-sm text-lg font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 transition-colors ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          🛡️ Continue as Guardian
        </button>
      </div>
    </div>
  );
};

export default RoleSelection;

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, signInWithPopup, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';
import { motion } from 'framer-motion';

const Register = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'tourist',
    city: '',
    state: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
       await setPersistence(auth, browserSessionPersistence);
       const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
       
       const userData = {
         name: formData.name,
         email: formData.email,
         role: formData.role,
         createdAt: new Date().toISOString()
       };

       if (formData.role === 'guide') {
         userData.city = formData.city;
         userData.state = formData.state;
       }

       await setDoc(doc(db, 'users', userCredential.user.uid), userData);

       const route = formData.role === 'guide' ? '/guide-dashboard' : formData.role === 'parent' ? '/parent-dashboard' : '/dashboard';
       navigate(route);
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('An account already exists with this email address.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak. Please use at least 6 characters.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await setPersistence(auth, browserSessionPersistence);
      const userCredential = await signInWithPopup(auth, googleProvider);
      const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const route = userData.role === 'guide' ? '/guide-dashboard' : userData.role === 'parent' ? '/parent-dashboard' : '/dashboard';
        navigate(route);
      } else {
        navigate('/role-selection', { 
           state: { 
             uid: userCredential.user.uid, 
             email: userCredential.user.email, 
             name: userCredential.user.displayName 
           } 
        });
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Google sign-in was cancelled.');
      } else {
        setError('Google sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="w-full h-full min-h-[80vh] flex items-center justify-center">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md glass-panel p-8 rounded-3xl relative z-10 text-slate-200">
        <h2 className="text-3xl font-extrabold text-center text-white mb-2 tracking-tight">Create Account</h2>
        <p className="text-center text-cyan-400 mb-6 font-bold tracking-wide text-sm uppercase">Join TravelEase</p>
        
        {error && <div className="bg-red-900/50 text-red-300 border border-red-500/50 p-3 rounded-xl mb-6 text-sm font-bold text-center">{error}</div>}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-300 mb-2">Full Name</label>
            <input
              type="text"
              required
              className="glass-input block w-full px-4 py-3 rounded-xl"
              placeholder="John Doe"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-300 mb-2">Email Address</label>
            <input
              type="email"
              required
              className="glass-input block w-full px-4 py-3 rounded-xl"
              placeholder="you@example.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-300 mb-2">Password</label>
            <input
              type="password"
              required
              className="glass-input block w-full px-4 py-3 rounded-xl"
              placeholder="••••••••"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-300 mb-2">I am a</label>
            <div className="relative">
              <select
                className="glass-input block w-full px-4 py-3 rounded-xl appearance-none font-bold text-white"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              >
                <option value="tourist" className="bg-slate-900">Tourist exploring the city</option>
                <option value="guide" className="bg-slate-900">Local Guide</option>
                <option value="parent" className="bg-slate-900">Parent / Guardian</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
              </div>
            </div>
          </div>

          {formData.role === 'guide' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex gap-4">
              <div className="w-1/2">
                <label className="block text-sm font-bold text-slate-300 mb-2">Operating City</label>
                <input
                  type="text"
                  required
                  className="glass-input block w-full px-4 py-3 rounded-xl"
                  placeholder="e.g. Mumbai"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>
              <div className="w-1/2">
                <label className="block text-sm font-bold text-slate-300 mb-2">Operating State</label>
                <input
                  type="text"
                  required
                  className="glass-input block w-full px-4 py-3 rounded-xl"
                  placeholder="e.g. Maharashtra"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                />
              </div>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full flex justify-center py-3 px-4 rounded-xl shadow-lg text-sm font-extrabold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 focus:outline-none transition-all mt-4 ${loading ? 'opacity-70 cursor-not-allowed' : 'hover:-translate-y-0.5 hover:shadow-cyan-500/20'}`}
          >
            {loading ? 'Creating Account...' : 'Sign Up'}
          </button>
        </form>

        <div className="relative mt-6 mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-slate-900 text-slate-400 font-black tracking-widest rounded-full border border-white/10">OR</span>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={handleGoogleLogin}
          className={`w-full flex justify-center items-center gap-3 py-3 px-4 bg-white/5 border border-white/10 rounded-xl shadow-sm text-sm font-extrabold text-white hover:bg-white/10 focus:outline-none transition-all ${loading ? 'opacity-70 cursor-not-allowed' : 'hover:-translate-y-0.5'}`}
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="h-5 w-5" alt="Google" />
          Continue with Google
        </button>

        <p className="mt-8 text-center text-sm font-bold text-slate-400">
          Already have an account? <Link to="/login" className="text-cyan-400 hover:text-cyan-300 transition-colors border-b border-cyan-400/30 hover:border-cyan-300 pb-0.5">Login here</Link>
        </p>
      </motion.div>
    </div>
  );
};

export default Register;

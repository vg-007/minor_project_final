import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, signInWithPopup, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';
import { motion } from 'framer-motion';

const Login = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await setPersistence(auth, browserSessionPersistence);
      const userCredential = await signInWithEmailAndPassword(auth, formData.email, formData.password);
      
      const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const route = userData.role === 'guide' ? '/guide-dashboard' : userData.role === 'parent' ? '/parent-dashboard' : '/dashboard';
        navigate(route);
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/invalid-credential') {
        setError('Incorrect email or password.');
      } else if (err.code === 'auth/user-not-found') {
        setError('No account found with this email.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect password provided.');
      } else {
        setError('Login failed. Please check your credentials.');
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
        // user does NOT exist, redirect to RoleSelection page
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
        <h2 className="text-3xl font-extrabold text-center text-white mb-2 tracking-tight">Welcome Back</h2>
        <p className="text-center text-cyan-400 mb-6 font-bold tracking-wide text-sm uppercase">Login to TravelEase</p>
        
        {error && <div className="bg-red-900/50 text-red-300 border border-red-500/50 p-3 rounded-xl mb-6 text-sm font-bold text-center">{error}</div>}
      
        <form onSubmit={handleSubmit} className="space-y-5">
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
          <button
            type="submit"
            disabled={loading}
            className={`w-full flex justify-center py-3 px-4 rounded-xl shadow-lg text-sm font-extrabold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 focus:outline-none transition-all ${loading ? 'opacity-70 cursor-not-allowed' : 'hover:-translate-y-0.5 hover:shadow-cyan-500/20'}`}
          >
            {loading ? 'Authenticating...' : 'Initialize Session'}
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
          New to the network? <Link to="/register" className="text-cyan-400 hover:text-cyan-300 transition-colors border-b border-cyan-400/30 hover:border-cyan-300 pb-0.5">Register here</Link>
        </p>
      </motion.div>
    </div>
  );
};

export default Login;

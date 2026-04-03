import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { CreateReel } from "./pages/CreateReel";
import { CreateAd } from "./pages/CreateAd";
import { Landing } from "./pages/Landing";
import { Editor } from "./pages/Editor";
import { ImageAdGenerator } from "./pages/ImageAdGenerator";
import { Login } from "./pages/Login";
import { clearStoredUser, getStoredUser, storeUser, type AuthUser } from "./services/auth";
import { signOutFirebaseAuth, subscribeToFirebaseAuth, syncFirebaseUserToBackend } from "./services/firebase";

import { Navbar } from "./components/Navbar";

function AppContent() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const location = useLocation();

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToFirebaseAuth(async (firebaseUser) => {
      if (!firebaseUser) return;

      const current = getStoredUser();
      if (current?.email === firebaseUser.email) {
        return;
      }

      try {
        const bridgedUser = await syncFirebaseUserToBackend(firebaseUser);
        setUser(bridgedUser);
        storeUser(bridgedUser);
      } catch (error) {
        console.error("Failed to sync Firebase user", error);
      }
    });

    return unsubscribe;
  }, []);

  const login = (userData: AuthUser) => {
    setUser(userData);
    storeUser(userData);
  };

  const logout = async () => {
    setUser(null);
    clearStoredUser();
    try {
      await signOutFirebaseAuth();
    } catch (error) {
      console.warn("Failed to sign out Firebase user", error);
    }
  };

  // Don't show Navbar on Landing page
  const showNavbar = location.pathname !== "/";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#0a0a0a] font-sans">
      {showNavbar && <Navbar user={user} onLogout={logout} />}
      <main>
        <Routes>
          <Route path="/" element={<Landing onLogin={login} user={user} />} />
          <Route path="/login" element={<Login onLogin={login} user={user} />} />
          <Route 
            path="/dashboard" 
            element={user ? <Dashboard user={user} /> : <Navigate to="/login?redirect=%2Fdashboard" />} 
          />
          <Route
            path="/create"
            element={user ? <CreateAd user={user} /> : <Navigate to="/login?redirect=%2Fcreate" />}
          />
          <Route
            path="/create-reels"
            element={user ? <CreateReel user={user} /> : <Navigate to="/login?redirect=%2Fcreate-reels" />}
          />
          <Route
            path="/editor/:id"
            element={user ? <Editor user={user} /> : <Navigate to="/login" />}
          />
          <Route
            path="/image-ads"
            element={user ? <ImageAdGenerator user={user} /> : <Navigate to="/login?redirect=%2Fimage-ads" />}
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

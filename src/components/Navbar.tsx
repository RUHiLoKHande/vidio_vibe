import { Link } from "react-router-dom";
import { Video, LogOut, User as UserIcon, Sparkles } from "lucide-react";

interface NavbarProps {
  user: any;
  onLogout: () => void;
}

export function Navbar({ user, onLogout }: NavbarProps) {
  return (
    <nav className="border-b border-white/10 bg-black/20 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg shadow-purple-500/25">
              <Video className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">
              Vibe<span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">AI</span> Ad Studio
            </span>
          </Link>

          <div className="flex items-center gap-6">
            {user ? (
              <>
                <Link to="/dashboard" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
                  Dashboard
                </Link>
                <Link to="/create?type=ad" className="text-sm font-medium bg-gradient-to-r from-purple-600 to-pink-600 text-white px-5 py-2.5 rounded-xl hover:shadow-lg hover:shadow-purple-500/25 transition-all">
                  Create New
                </Link>
                <div className="flex items-center gap-3 pl-4 border-l border-white/10">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                    <UserIcon className="w-4 h-4 text-white/70" />
                  </div>
                  <button 
                    onClick={onLogout}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4 text-white/70" />
                  </button>
                </div>
              </>
            ) : (
              <Link 
                to="/login" 
                className="text-sm font-medium bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-2.5 rounded-xl hover:shadow-lg hover:shadow-purple-500/25 transition-all"
              >
                Get Started
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

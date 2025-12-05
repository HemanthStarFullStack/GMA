import Link from "next/link";
import { Camera, Package, History, Settings, BarChart3, LogIn, ArrowRight } from "lucide-react";
import { auth } from "@/auth";

export default async function HomePage() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="text-center mb-12 relative">
          <div className="absolute top-0 right-0 flex gap-4">
            {session ? (
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full">
                {session.user?.image && (
                  <img src={session.user.image} alt="User" className="w-8 h-8 rounded-full border-2 border-white" />
                )}
                <span className="text-white font-medium">{session.user?.name}</span>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-2 bg-white text-blue-600 px-4 py-2 rounded-full font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </Link>
            )}
          </div>

          <h1 className="text-5xl font-bold text-white mb-4 pt-10">
            🛒 SINTI V2
          </h1>
          <p className="text-xl text-purple-100">
            Smart Inventory Tracking with AI
          </p>
        </header>

        {/* Main Action */}
        <div className="max-w-2xl mx-auto mb-12">
          {session ? (
            <Link
              href="/scan"
              className="block bg-white hover:bg-gray-50 rounded-2xl shadow-2xl p-12 text-center transition-all hover:scale-105 duration-200"
            >
              <Camera className="w-24 h-24 mx-auto mb-6 text-purple-600" />
              <h2 className="text-3xl font-bold text-gray-900 mb-3">
                Scan Product
              </h2>
              <p className="text-gray-600 text-lg">
                Use your camera to scan barcodes instantly
              </p>
            </Link>
          ) : (
            <Link
              href="/login"
              className="block bg-white hover:bg-gray-50 rounded-2xl shadow-2xl p-12 text-center transition-all hover:scale-105 duration-200"
            >
              <LogIn className="w-24 h-24 mx-auto mb-6 text-blue-600" />
              <h2 className="text-3xl font-bold text-gray-900 mb-3">
                Sign In to Start
              </h2>
              <p className="text-gray-600 text-lg flex items-center justify-center gap-2">
                Create your account to track inventory <ArrowRight className="w-5 h-5" />
              </p>
            </Link>
          )}

        </div>

        {/* Quick Actions Grid */}
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link
            href="/inventory"
            className="bg-white/10 backdrop-blur-md hover:bg-white/20 rounded-xl p-6 text-center transition-all hover:scale-105"
          >
            <Package className="w-12 h-12 mx-auto mb-3 text-white" />
            <h3 className="font-semibold text-white">Inventory</h3>
          </Link>

          <Link
            href="/history"
            className="bg-white/10 backdrop-blur-md hover:bg-white/20 rounded-xl p-6 text-center transition-all hover:scale-105"
          >
            <History className="w-12 h-12 mx-auto mb-3 text-white" />
            <h3 className="font-semibold text-white">History</h3>
          </Link>

          <Link
            href="/analytics"
            className="bg-white/10 backdrop-blur-md hover:bg-white/20 rounded-xl p-6 text-center transition-all hover:scale-105"
          >
            <BarChart3 className="w-12 h-12 mx-auto mb-3 text-white" />
            <h3 className="font-semibold text-white">Analytics</h3>
          </Link>

          <Link
            href="/settings"
            className="bg-white/10 backdrop-blur-md hover:bg-white/20 rounded-xl p-6 text-center transition-all hover:scale-105"
          >
            <Settings className="w-12 h-12 mx-auto mb-3 text-white" />
            <h3 className="font-semibold text-white">Settings</h3>
          </Link>
        </div>

        {/* Stats Preview */}
        <div className="max-w-4xl mx-auto mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-white mb-2">0</div>
            <div className="text-purple-100">Items Tracked</div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-white mb-2">0</div>
            <div className="text-purple-100">Products Scanned</div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-white mb-2">-</div>
            <div className="text-purple-100">Family Size</div>
          </div>
        </div>
      </div>
    </div>
  );
}

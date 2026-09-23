import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Landing(): React.ReactElement {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-zinc-950 text-zinc-100">
      {/* Left Column: Full-Bleed Ambulance Bay Photo */}
      <div className="lg:w-1/2 w-full h-80 lg:h-screen relative bg-zinc-900 border-b lg:border-b-0 lg:border-r border-zinc-800">
        <img
          src="https://images.unsplash.com/photo-1587745416684-47953f16f02f?auto=format&fit=crop&w=1600&q=80"
          alt="Emergency Ambulance Bay"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Right Column: Navigation & Hero Content */}
      <div className="lg:w-1/2 w-full flex flex-col justify-between p-6 sm:p-12 lg:p-16">
        {/* Top Nav */}
        <header className="flex items-center justify-between pb-8 border-b border-zinc-800">
          <div className="flex items-center space-x-2">
            <span className="text-xl font-bold tracking-tight text-white">HIP</span>
            <span className="text-xs uppercase tracking-widest text-zinc-400 font-mono">Platform</span>
          </div>

          <nav className="hidden sm:flex items-center space-x-6 text-sm text-zinc-400">
            <a href="#about" className="hover:text-white transition-colors">About</a>
            <a href="#faqs" className="hover:text-white transition-colors">FAQs</a>
            <a href="#contact" className="hover:text-white transition-colors">Contact</a>
          </nav>

          <button
            onClick={() => navigate('/login')}
            className="border border-zinc-700 hover:border-zinc-500 text-white text-sm px-4 py-2 font-medium"
          >
            Staff Sign In
          </button>
        </header>

        {/* Hero Headline & CTA */}
        <main className="my-auto py-12">
          <p className="text-xs font-mono uppercase tracking-widest text-red-500 font-semibold mb-4">
            Critical Healthcare Operations
          </p>
          <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-bold text-white leading-tight mb-6">
            Rapid Response, 24/7
          </h1>
          <p className="text-base sm:text-lg text-zinc-400 leading-relaxed max-w-xl mb-10">
            Automated emergency triage, live bed availability telemetry, and instant clinical resource coordination designed for high-acuity patient intake.
          </p>
          <div>
            <button
              onClick={() => navigate('/login')}
              className="bg-white text-zinc-950 hover:bg-zinc-200 px-8 py-3.5 text-base font-semibold tracking-wide"
            >
              Access Clinical Portal
            </button>
          </div>
        </main>

        {/* Footer info */}
        <footer className="pt-8 border-t border-zinc-800 text-xs text-zinc-500 font-mono uppercase tracking-wider flex flex-col sm:flex-row justify-between gap-2">
          <span>Level 1 Trauma Verified</span>
          <span>HIPAA & 21 CFR Part 11 Compliant</span>
        </footer>
      </div>
    </div>
  );
}

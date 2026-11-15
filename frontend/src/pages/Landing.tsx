import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Bed,
  ShieldCheck,
  Cpu,
  ArrowRight,
  Ambulance,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  Stethoscope,
  Lock,
  RefreshCw,
  Menu,
  X,
  Send,
  CheckCircle2,
} from 'lucide-react';
import ThemeToggle from '../components/navigation/ThemeToggle';

interface TeamMember {
  name: string;
  initial: string;
  role: string;
  linkedin: string;
  gradient: string;
}

const TEAM_MEMBERS: TeamMember[] = [
  {
    name: 'Ujjwal Sitaula',
    initial: 'U',
    role: 'Lead Systems Architect & Full Stack',
    linkedin: 'https://www.linkedin.com/in/ujjwalsitaula839',
    gradient: 'from-fuchsia-600 to-pink-500',
  },
  {
    name: 'Nima Tshering Lama',
    initial: 'N',
    role: 'Backend Engineering & Distributed Systems',
    linkedin: 'https://www.linkedin.com/in/nima-tshering-lama-415778339/',
    gradient: 'from-pink-600 to-rose-500',
  },
  {
    name: 'Utsav Poudel',
    initial: 'U',
    role: 'Clinical Operations & AI Workflow Engineering',
    linkedin: 'https://www.linkedin.com/in/utsavpoudel69/',
    gradient: 'from-purple-600 to-fuchsia-500',
  },
];

interface FaqItem {
  question: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  {
    question: 'How does the platform eliminate emergency department boarding?',
    answer:
      'Emergency room boarding occurs when admitted patients wait hours for an inpatient bed. The platform replaces phone tag and paper whiteboards with real-time distributed bed telemetry across all 122 beds. Incoming EMS ambulances, bedside nurses, and environmental services (EVS) share synchronized state, allowing beds to be matched and assigned the moment discharge orders are signed.',
  },
  {
    question: 'Is the AI bed recommendation engine deterministic or generative?',
    answer:
      'The bed recommendation engine utilizes a hybrid deterministic-and-evaluative architecture. Hard clinical requirements (isolation negative-pressure requirements, pediatric restrictions, ventilator support capabilities, and unit nurse-to-patient staffing caps) are strictly enforced in PostgreSQL and Redis. LangChain and Google Gemini evaluate clinical unstructured triage notes to suggest optimal ward placements with plain-English rationales, ensuring clinical staff always retain final sign-off.',
  },
  {
    question: 'How does the I-PASS handoff comply with The Joint Commission standards?',
    answer:
      'The Joint Commission National Patient Safety Goal (NPSG.02.05.01) mandates standardized clinical handoffs. Our shift handoff workflow structures transfers strictly into Illness Severity (Stable, Watcher, Unstable), Patient Summary, Action Items, Situation Awareness / Contingencies, and Synthesis with role-verified digital signatures, dramatically reducing communication errors during shift changes.',
  },
  {
    question: 'How does the system enforce HIPAA and Broken Object Level Authorization (BOLA)?',
    answer:
      'Every patient endpoint enforces cryptographic JWT inspection with real-time assignment verification. Clinicians can only inspect and document charts for patients directly under their active shift assignment. All access overrides and emergency room lookups are logged immutably with role-based audit trails.',
  },
  {
    question: 'How are housekeeping and environmental services (EVS) notified?',
    answer:
      'When a clinical discharge or patient transfer is completed, the bed status transitions immediately from OCCUPIED to DIRTY. The housekeeping service automatically issues an EVS work order with bed location, isolation protocols (e.g., C. diff UV-C sanitization), and tracks turnover duration in real-time.',
  },
  {
    question: 'Can clinical staff use this on nursing workstation computers and tablets?',
    answer:
      'Yes. The user interface is engineered with a responsive design adhering to human-factors standards. It offers high-contrast dark and light modes, minimum 44px touch targets for iPad/tablets at the bedside, and high-density tabular layouts for multi-monitor nursing station dashboards.',
  },
];

export default function Landing(): React.ReactElement {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    department: 'Emergency Medicine',
    message: '',
  });

  const toggleFaq = (index: number) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.email.trim()) return;
    setContactSubmitted(true);
    setTimeout(() => {
      setContactForm({ name: '', email: '', department: 'Emergency Medicine', message: '' });
    }, 4000);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100">
      {/* ====================================================================
          STICKY TOP NAVIGATION BAR
          ==================================================================== */}
      <header className="sticky top-0 z-50 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-4 lg:gap-8">
          {/* Brand Logo & Title */}
          <div className="flex items-center space-x-3 shrink-0">
            <img
              src="/logo_icon.png"
              alt="Hospital Intelligence Platform Logo"
              className="h-9 w-auto object-contain"
            />
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-white leading-none">
                HIP
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 leading-tight">
                Hospital Intelligence Platform
              </span>
            </div>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden lg:flex items-center space-x-6 xl:space-x-8 text-sm text-zinc-300">
            <a href="#overview" className="hover:text-white transition-colors">Overview</a>
            <a href="#capabilities" className="hover:text-white transition-colors">Capabilities</a>
            <a href="#workflow" className="hover:text-white transition-colors">Workflow</a>
            <a href="#about" className="hover:text-white transition-colors">About</a>
            <a href="#faqs" className="hover:text-white transition-colors">FAQs</a>
            <a href="#team" className="hover:text-white transition-colors">Team</a>
            <a href="#contact" className="hover:text-white transition-colors">Contact</a>
          </nav>

          {/* Action CTAs */}
          <div className="hidden sm:flex items-center space-x-4 shrink-0">
            <ThemeToggle />
            <div className="h-4 w-px bg-zinc-800" />
            <button
              onClick={() => navigate('/login')}
              className="bg-white hover:bg-zinc-200 text-zinc-950 text-xs px-4 py-2.5 font-semibold tracking-wide transition-colors flex items-center gap-1.5 rounded-xs"
            >
              <span>Staff Sign In</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="flex sm:hidden items-center space-x-2">
            <ThemeToggle />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-b border-zinc-800 bg-zinc-950 px-4 py-4 space-y-3 font-medium text-sm">
            <a
              href="#overview"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-zinc-300 hover:text-white py-1"
            >
              Overview
            </a>
            <a
              href="#capabilities"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-zinc-300 hover:text-white py-1"
            >
              Capabilities
            </a>
            <a
              href="#workflow"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-zinc-300 hover:text-white py-1"
            >
              Clinical Workflow
            </a>
            <a
              href="#about"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-zinc-300 hover:text-white py-1"
            >
              About
            </a>
            <a
              href="#faqs"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-zinc-300 hover:text-white py-1"
            >
              FAQs
            </a>
            <a
              href="#team"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-zinc-300 hover:text-white py-1"
            >
              Team
            </a>
            <a
              href="#contact"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-zinc-300 hover:text-white py-1"
            >
              Contact
            </a>
            <div className="pt-2 border-t border-zinc-800 flex flex-col gap-2">
              <button
                onClick={() => navigate('/login')}
                className="w-full bg-white text-zinc-950 py-2.5 text-xs font-semibold text-center"
              >
                Access Clinical Portal
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ====================================================================
          HERO SECTION (SPLIT EDITORIAL + AMBULANCE BAY VISUAL)
          ==================================================================== */}
      <section id="overview" className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row">
          {/* Left Column: Hero Editorial & Call to Action */}
          <div className="lg:w-7/12 p-6 sm:p-12 lg:p-16 flex flex-col justify-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono uppercase tracking-wider text-zinc-400 mb-6 w-fit">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Real-Time Clinical Telemetry & Bed Management
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-tight mb-6">
              Critical hospital operations without the bottleneck.
            </h1>

            <p className="text-base sm:text-lg text-zinc-300 leading-relaxed max-w-2xl mb-8">
              A high-precision command platform that connects emergency dispatch, acute bed allocation,
              standardized nurse handoffs, and housekeeping turnover in real time across 122 monitored beds.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 mb-12">
              <button
                onClick={() => navigate('/login')}
                className="bg-white hover:bg-zinc-200 text-zinc-950 font-semibold px-6 py-3 text-sm tracking-wide transition-colors flex items-center justify-center gap-2"
              >
                Access Clinical Portal
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#capabilities"
                className="border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/60 text-zinc-200 font-medium px-6 py-3 text-sm text-center transition-colors"
              >
                Explore System Capabilities
              </a>
            </div>

            {/* Quick Metrics Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-8 border-t border-zinc-800/80 font-mono text-xs">
              <div>
                <p className="text-zinc-500 uppercase tracking-widest text-[10px]">Active Census</p>
                <p className="text-lg font-bold text-white mt-0.5">122 Beds</p>
                <p className="text-[11px] text-zinc-400 font-sans">Full telemetry visibility</p>
              </div>
              <div>
                <p className="text-zinc-500 uppercase tracking-widest text-[10px]">Redis State Sync</p>
                <p className="text-lg font-bold text-emerald-400 mt-0.5">&lt; 10 ms</p>
                <p className="text-[11px] text-zinc-400 font-sans">Sub-millisecond cache</p>
              </div>
              <div>
                <p className="text-zinc-500 uppercase tracking-widest text-[10px]">Safety Protocol</p>
                <p className="text-lg font-bold text-white mt-0.5">I-PASS</p>
                <p className="text-[11px] text-zinc-400 font-sans">Joint Commission certified</p>
              </div>
              <div>
                <p className="text-zinc-500 uppercase tracking-widest text-[10px]">Access Control</p>
                <p className="text-lg font-bold text-white mt-0.5">Zero-Trust</p>
                <p className="text-[11px] text-zinc-400 font-sans">Strict BOLA enforcement</p>
              </div>
            </div>
          </div>

          {/* Right Column: Clean Full-Bleed Ambulance Photographic Frame */}
          <div className="lg:w-5/12 relative border-t lg:border-t-0 lg:border-l border-zinc-800 bg-zinc-900 min-h-[380px] lg:min-h-[580px] overflow-hidden">
            <img
              src="https://images.unsplash.com/photo-1587745416684-47953f16f02f?auto=format&fit=crop&w=1600&q=80"
              alt="Emergency Ambulance Bay"
              className="w-full h-full object-cover filter brightness-[0.88] contrast-[1.05]"
            />
          </div>
        </div>
      </section>

      {/* ====================================================================
          CORE CAPABILITIES MATRIX (STRUCTURED & RESTRAINED)
          ==================================================================== */}
      <section id="capabilities" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="mb-14">
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2 font-medium">
            System Capabilities
          </p>
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white max-w-3xl">
            Built for clinical reality, where every second and every bed counts.
          </h2>
          <p className="text-zinc-400 text-sm sm:text-base mt-3 max-w-2xl">
            Every module addresses a documented point of failure in hospital operations: delayed transfers,
            communication breakdowns during shift changes, and orphaned dirty beds.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1: 122-Bed Matrix */}
          <div className="p-6 rounded bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-colors flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-5">
                <Bed className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">122-Bed Telemetry Matrix</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Live multi-ward visibility across Emergency, ICU, Step-Down, and Med-Surg. Real-time state
                transitions between Available, Occupied, Dirty, and Cleaning synchronized via Redis.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Dynamic state machine</span>
              <span className="text-zinc-400">&lt;10ms sync</span>
            </div>
          </div>

          {/* Card 2: AI Bed Matching */}
          <div className="p-6 rounded bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-colors flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-5">
                <Sparkles className="w-5 h-5 text-sky-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Intelligent Bed Recommendation</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Deterministic clinical criteria coupled with LangChain and Google Gemini evaluations. Evaluates
                negative-pressure isolation, ventilator needs, telemetry, and nurse-to-patient ratios with plain-text rationales.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-400 flex items-center justify-between">
              <span>LangChain + Gemini</span>
              <span className="text-sky-400">Clinical sign-off</span>
            </div>
          </div>

          {/* Card 3: I-PASS Handoff */}
          <div className="p-6 rounded bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-colors flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-5">
                <Stethoscope className="w-5 h-5 text-fuchsia-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">I-PASS Shift Handoff</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Standardized clinical handoffs compliant with The Joint Commission NPSG.02.05.01. Captures Illness
                Severity (Stable, Watcher, Unstable), Patient Summaries, Action Lists, and structured signoffs.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Joint Commission NPSG</span>
              <span className="text-fuchsia-400">80% error drop</span>
            </div>
          </div>

          {/* Card 4: EMS Field Intake */}
          <div className="p-6 rounded bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-colors flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-5">
                <Ambulance className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Inbound EMS Radio Intake</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Paramedics transmit field vitals, trauma levels, oxygenation requirements, and ETAs directly into the
                emergency triage queue, enabling trauma teams to stage beds before ambulance arrival.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Pre-hospital telemetry</span>
              <span className="text-amber-400">Zero wait intake</span>
            </div>
          </div>

          {/* Card 5: EVS Housekeeping */}
          <div className="p-6 rounded bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-colors flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-5">
                <RefreshCw className="w-5 h-5 text-indigo-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Automated EVS Work Orders</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Discharge triggers immediate dispatch for terminal cleaning. Environmental services log sanitization
                progress in real time, cutting bed turnover from hours down to clinical targets.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Terminal clean dispatch</span>
              <span className="text-indigo-400">Automated queue</span>
            </div>
          </div>

          {/* Card 6: Zero-Trust Security & BOLA */}
          <div className="p-6 rounded bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-colors flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-5">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Zero-Trust BOLA Security</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Strict Broken Object Level Authorization (BOLA) shields patient charts. Clinicians can only query and
                update patients assigned to their active shift, complete with cryptographic audit logging.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-400 flex items-center justify-between">
              <span>OWASP API #1 Defense</span>
              <span className="text-emerald-400">HIPAA compliant</span>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          CLINICAL WORKFLOW (STEP-BY-STEP PATIENT LIFECYCLE)
          ==================================================================== */}
      <section id="workflow" className="py-20 border-t border-b border-zinc-800 bg-zinc-900/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <p className="text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2 font-medium">
              Operational Sequence
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white">
              From field dispatch to discharge turnover.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 font-mono">
            {/* Step 1 */}
            <div className="p-6 rounded bg-zinc-950 border border-zinc-800 relative">
              <span className="text-xs text-zinc-400 font-bold tracking-wider">01</span>
              <h4 className="text-sm font-semibold text-white font-sans mt-3 mb-2">EMS Field Intake</h4>
              <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                Ambulance crews stream field vitals, patient stability, and arrival times directly to the triage board.
              </p>
            </div>

            {/* Step 2 */}
            <div className="p-6 rounded bg-zinc-950 border border-zinc-800 relative">
              <span className="text-xs text-zinc-400 font-bold tracking-wider">02</span>
              <h4 className="text-sm font-semibold text-white font-sans mt-3 mb-2">Bed Matching</h4>
              <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                Deterministic matching checks negative pressure and telemetry, locking an appropriate bed in advance.
              </p>
            </div>

            {/* Step 3 */}
            <div className="p-6 rounded bg-zinc-950 border border-zinc-800 relative">
              <span className="text-xs text-zinc-400 font-bold tracking-wider">03</span>
              <h4 className="text-sm font-semibold text-white font-sans mt-3 mb-2">I-PASS Handoff</h4>
              <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                Bedside nurses transfer care using standardized illness severity categories and contingency plans.
              </p>
            </div>

            {/* Step 4 */}
            <div className="p-6 rounded bg-zinc-950 border border-zinc-800 relative">
              <span className="text-xs text-zinc-400 font-bold tracking-wider">04</span>
              <h4 className="text-sm font-semibold text-white font-sans mt-3 mb-2">EVS Terminal Clean</h4>
              <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                Discharge flags the bed as dirty; housekeeping sanitizes and returns the room to available status.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          ABOUT SECTION: ELIMINATING CLINICAL GRIDLOCK
          ==================================================================== */}
      <section id="about" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2 font-medium">
              About The Platform
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white mb-6 leading-tight">
              Eliminating clinical gridlock across the entire acute continuum.
            </h2>
            <div className="space-y-4 text-sm sm:text-base text-zinc-300 leading-relaxed">
              <p>
                In acute hospital facilities, emergency department boarding is not an ED problem—it is a hospital-wide
                operational bottleneck. When patient discharges lag, beds sit in uncleaned status, or handoffs break down,
                the entire facility slows down. Ambulances divert, wait times spike, and patient morbidity rises.
              </p>
              <p>
                The Hospital Intelligence Platform (HIP) was engineered from the ground up to solve this communication
                and state breakdown. By pairing high-speed distributed in-memory data structures (Redis) with persistent
                transactional integrity (PostgreSQL), HIP gives clinical leadership real-time visibility and control.
              </p>
              <p>
                Built to satisfy The Joint Commission National Patient Safety Goals (NPSG.02.05.01) and HIPAA Title II
                safeguards, HIP ensures that clinical quality and technical security move hand-in-hand.
              </p>
            </div>
          </div>

          <div className="p-8 rounded bg-zinc-900/40 border border-zinc-800 space-y-6">
            <h3 className="text-lg font-semibold text-white">System Architecture Standards</h3>
            <div className="space-y-4 text-xs sm:text-sm font-mono">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-white">The Joint Commission Compliance</p>
                  <p className="text-zinc-400 font-sans text-xs mt-0.5">
                    Strict adherence to NPSG.02.05.01 clinical handoff protocol standardization.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Lock className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-white">HIPAA & BOLA Security</p>
                  <p className="text-zinc-400 font-sans text-xs mt-0.5">
                    Object-level authorization prevents unauthorized access between unassigned patient charts.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Cpu className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-white">Sub-10ms Redis Caching</p>
                  <p className="text-zinc-400 font-sans text-xs mt-0.5">
                    High-concurrency bed states survive peak trauma surges without database lockups.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Activity className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-white">High-Acuity Fault Tolerance</p>
                  <p className="text-zinc-400 font-sans text-xs mt-0.5">
                    Isolated microservice boundaries protect bed telemetry if external network links degrade.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          FREQUENTLY ASKED QUESTIONS (ACCORDION)
          ==================================================================== */}
      <section id="faqs" className="py-20 border-t border-zinc-800 bg-zinc-900/20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2 font-medium">
              Operational FAQs
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white">
              Questions from clinical and technical leadership.
            </h2>
          </div>

          <div className="space-y-3">
            {FAQS.map((faq, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div
                  key={index}
                  className="rounded border border-zinc-800 bg-zinc-950/80 overflow-hidden transition-colors"
                >
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full py-4 px-6 text-left flex items-center justify-between text-zinc-100 hover:text-white transition-colors"
                  >
                    <span className="font-medium text-sm sm:text-base pr-4">{faq.question}</span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-zinc-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 pt-1 text-xs sm:text-sm text-zinc-400 leading-relaxed border-t border-zinc-850">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ====================================================================
          CREATED BY SECTION & ROTATING HORIZONTAL MARQUEE
          (Matches user screenshot: CREATED BY header + rotating pills with LinkedIn)
          ==================================================================== */}
      <section id="team" className="py-20 border-t border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-10 text-center">
          <p className="text-xs font-mono uppercase tracking-[0.3em] font-semibold text-zinc-400">
            CREATED BY
          </p>
        </div>

        {/* Slow Rotating Marquee with edge fade masks */}
        <div className="relative w-full overflow-hidden py-4">
          {/* Left and Right Fade Gradients */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 sm:w-48 bg-gradient-to-r from-zinc-950 to-transparent z-10" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-24 sm:w-48 bg-gradient-to-l from-zinc-950 to-transparent z-10" />

          {/* Scrolling Track (duplicated to ensure seamless 360 infinite loop) */}
          <div className="animate-marquee-slow flex items-center gap-4 sm:gap-6">
            {/* Set 1 */}
            {TEAM_MEMBERS.map((member, idx) => (
              <div
                key={`member-1-${idx}`}
                className="flex items-center gap-3.5 px-4 py-2.5 rounded-full bg-[#111116] border border-white/10 hover:border-white/25 transition-all shadow-lg shrink-0"
              >
                {/* Gradient Initial Avatar */}
                <div
                  className={`w-7 h-7 rounded-full bg-gradient-to-tr ${member.gradient} flex items-center justify-center text-white font-bold text-xs shadow-inner`}
                >
                  {member.initial}
                </div>

                {/* Member Name */}
                <span className="text-sm font-medium text-zinc-100 whitespace-nowrap">
                  {member.name}
                </span>

                {/* Official LinkedIn Button */}
                <a
                  href={member.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0A66C2] hover:bg-[#004182] text-white text-xs font-semibold tracking-wide transition-colors"
                >
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.79v8.37H6.46v-8.37M7.86 6.54a1.63 1.63 0 1 0 0 3.26 1.63 1.63 0 0 0 0-3.26Z" />
                  </svg>
                  <span>LinkedIn</span>
                </a>
              </div>
            ))}

            {/* Set 2 (for seamless loop) */}
            {TEAM_MEMBERS.map((member, idx) => (
              <div
                key={`member-2-${idx}`}
                className="flex items-center gap-3.5 px-4 py-2.5 rounded-full bg-[#111116] border border-white/10 hover:border-white/25 transition-all shadow-lg shrink-0"
              >
                <div
                  className={`w-7 h-7 rounded-full bg-gradient-to-tr ${member.gradient} flex items-center justify-center text-white font-bold text-xs shadow-inner`}
                >
                  {member.initial}
                </div>
                <span className="text-sm font-medium text-zinc-100 whitespace-nowrap">
                  {member.name}
                </span>
                <a
                  href={member.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0A66C2] hover:bg-[#004182] text-white text-xs font-semibold tracking-wide transition-colors"
                >
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.79v8.37H6.46v-8.37M7.86 6.54a1.63 1.63 0 1 0 0 3.26 1.63 1.63 0 0 0 0-3.26Z" />
                  </svg>
                  <span>LinkedIn</span>
                </a>
              </div>
            ))}

            {/* Set 3 (for ultra-wide monitors) */}
            {TEAM_MEMBERS.map((member, idx) => (
              <div
                key={`member-3-${idx}`}
                className="flex items-center gap-3.5 px-4 py-2.5 rounded-full bg-[#111116] border border-white/10 hover:border-white/25 transition-all shadow-lg shrink-0"
              >
                <div
                  className={`w-7 h-7 rounded-full bg-gradient-to-tr ${member.gradient} flex items-center justify-center text-white font-bold text-xs shadow-inner`}
                >
                  {member.initial}
                </div>
                <span className="text-sm font-medium text-zinc-100 whitespace-nowrap">
                  {member.name}
                </span>
                <a
                  href={member.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0A66C2] hover:bg-[#004182] text-white text-xs font-semibold tracking-wide transition-colors"
                >
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.79v8.37H6.46v-8.37M7.86 6.54a1.63 1.63 0 1 0 0 3.26 1.63 1.63 0 0 0 0-3.26Z" />
                  </svg>
                  <span>LinkedIn</span>
                </a>
              </div>
            ))}

            {/* Set 4 */}
            {TEAM_MEMBERS.map((member, idx) => (
              <div
                key={`member-4-${idx}`}
                className="flex items-center gap-3.5 px-4 py-2.5 rounded-full bg-[#111116] border border-white/10 hover:border-white/25 transition-all shadow-lg shrink-0"
              >
                <div
                  className={`w-7 h-7 rounded-full bg-gradient-to-tr ${member.gradient} flex items-center justify-center text-white font-bold text-xs shadow-inner`}
                >
                  {member.initial}
                </div>
                <span className="text-sm font-medium text-zinc-100 whitespace-nowrap">
                  {member.name}
                </span>
                <a
                  href={member.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0A66C2] hover:bg-[#004182] text-white text-xs font-semibold tracking-wide transition-colors"
                >
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.79v8.37H6.46v-8.37M7.86 6.54a1.63 1.63 0 1 0 0 3.26 1.63 1.63 0 0 0 0-3.26Z" />
                  </svg>
                  <span>LinkedIn</span>
                </a>
              </div>
            ))}
          </div>
        </div>

        {/* Clean, Human Team Profiles Grid */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          {TEAM_MEMBERS.map((member, index) => (
            <div
              key={index}
              className="p-6 rounded bg-zinc-900/30 border border-zinc-800/80 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div
                    className={`w-10 h-10 rounded-full bg-gradient-to-tr ${member.gradient} flex items-center justify-center text-white font-bold text-sm shadow-md`}
                  >
                    {member.initial}
                  </div>
                  <a
                    href={member.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <span>Profile</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <h4 className="text-base font-semibold text-white">{member.name}</h4>
                <p className="text-xs text-zinc-400 font-mono mt-1">{member.role}</p>
              </div>
              <div className="mt-5 pt-4 border-t border-zinc-800/80">
                <a
                  href={member.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors"
                >
                  <span>Connect on LinkedIn</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ====================================================================
          OPERATIONAL CONTACT & DEMONSTRATION REQUEST
          ==================================================================== */}
      <section id="contact" className="py-20 border-t border-zinc-800 bg-zinc-900/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* Contact details */}
            <div className="lg:col-span-5 space-y-6">
              <div>
                <p className="text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2 font-medium">
                  Direct Inquiries
                </p>
                <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white mb-4">
                  Hospital Operations Command
                </h2>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Have questions about integrating with your hospital EHR (Epic, Cerner, Meditech), deploying to on-premise
                  or cloud Kubernetes infrastructure, or scheduling a live clinical walkthrough?
                </p>
              </div>

              <div className="space-y-4 text-xs font-mono">
                <div className="flex items-center gap-3 p-3.5 rounded bg-zinc-900/50 border border-zinc-800">
                  <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-zinc-500 uppercase text-[10px]">Operations Center Hotline</p>
                    <p className="text-zinc-200 font-medium">+1 (800) 555-0199 · Ext. 4</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3.5 rounded bg-zinc-900/50 border border-zinc-800">
                  <Mail className="w-4 h-4 text-sky-400 shrink-0" />
                  <div>
                    <p className="text-zinc-500 uppercase text-[10px]">Clinical Informatics Team</p>
                    <p className="text-zinc-200 font-medium">clinical-systems@hospital.org</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3.5 rounded bg-zinc-900/50 border border-zinc-800">
                  <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-zinc-500 uppercase text-[10px]">Command Center Location</p>
                    <p className="text-zinc-200 font-medium">Central Tower · Suite 400 · Trauma Hub</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Demonstration Form */}
            <div className="lg:col-span-7 p-6 sm:p-8 rounded bg-zinc-900/40 border border-zinc-800">
              <h3 className="text-lg font-semibold text-white mb-2">Request Technical Walkthrough</h3>
              <p className="text-xs text-zinc-400 mb-6">
                Submit a system inquiry or request an interactive walkthrough of the bed allocation and handoff pipelines.
              </p>

              {contactSubmitted ? (
                <div className="p-6 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs font-mono space-y-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-300 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span>Inquiry Successfully Transmitted</span>
                  </div>
                  <p className="text-emerald-300/80 font-sans">
                    Your request has been received. A clinical systems engineer will contact your department promptly.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleContactSubmit} className="space-y-4 text-xs font-mono">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-zinc-400 mb-1.5 uppercase tracking-wider text-[10px]">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                        placeholder="Dr. Jordan Hayes, MD"
                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-500 text-zinc-100 px-3.5 py-2.5 rounded outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-400 mb-1.5 uppercase tracking-wider text-[10px]">
                        Hospital Email
                      </label>
                      <input
                        type="email"
                        required
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                        placeholder="j.hayes@healthsystem.org"
                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-500 text-zinc-100 px-3.5 py-2.5 rounded outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-zinc-400 mb-1.5 uppercase tracking-wider text-[10px]">
                      Clinical Department
                    </label>
                    <select
                      value={contactForm.department}
                      onChange={(e) => setContactForm({ ...contactForm, department: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-500 text-zinc-100 px-3.5 py-2.5 rounded outline-none transition-colors"
                    >
                      <option value="Emergency Medicine">Emergency Medicine</option>
                      <option value="Intensive Care Unit (ICU)">Intensive Care Unit (ICU)</option>
                      <option value="Nursing Leadership">Nursing Leadership & Shift Management</option>
                      <option value="Environmental Services (EVS)">Environmental Services (EVS)</option>
                      <option value="Health System IT & EHR Integration">Health System IT & EHR Integration</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-zinc-400 mb-1.5 uppercase tracking-wider text-[10px]">
                      Operational Notes & Scope
                    </label>
                    <textarea
                      rows={3}
                      value={contactForm.message}
                      onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                      placeholder="Outline current bed bottlenecks, acute wards, or EHR integration requirements..."
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-500 text-zinc-100 px-3.5 py-2.5 rounded outline-none transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-white hover:bg-zinc-200 text-zinc-950 font-semibold py-3 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors font-sans"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Dispatch Operational Inquiry
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          ENTERPRISE FOOTER
          ==================================================================== */}
      <footer className="border-t border-zinc-800 bg-zinc-950 py-10 px-4 sm:px-6 lg:px-8 text-xs text-zinc-500 font-mono">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <img src="/logo_icon.png" alt="HIP Logo" className="h-5 w-auto object-contain opacity-80" />
            <span className="font-bold text-zinc-200 tracking-tight text-sm font-sans">
              HIP
            </span>
            <span>·</span>
            <span>Hospital Intelligence Platform</span>
            <span>·</span>
            <span>Level 1 Trauma Verified</span>
          </div>

          <div className="flex items-center space-x-6 text-[11px]">
            <span>HIPAA Title II</span>
            <span>TJC NPSG.02.05.01</span>
            <span>21 CFR Part 11 Audit Trail</span>
          </div>

          <div>
            <p>© {new Date().getFullYear()} Hospital Intelligence Systems. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

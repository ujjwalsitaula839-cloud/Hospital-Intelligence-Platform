import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/landing.css';

const LANDING_HTML: string = `<section class="scrub" id="top" aria-label="From the ambulance to the right hospital">
<div class="page">
  <div class="card hero-dark">
    <img class="bg" src="/frames/f_001.webp" alt="" aria-hidden="true">
    <canvas class="bgc" aria-hidden="true"></canvas>
    <div class="tint"></div>

    <div class="scenes" aria-live="polite">
      <div class="scene">
        <span class="scene-k">01 <b>/ 03</b> Problem</span>
        <h2>Wrong door.<br>They turn around.</h2>
        <p>The crew commits to a hospital before anyone knows if that unit can take the patient.</p>
        <span class="scene-chip" style="--c:#CF4B3E"><i></i>Diversion · too late</span>
      </div>
      <div class="scene">
        <span class="scene-k">02 <b>/ 03</b> Why</span>
        <h2>The hospital knows.<br>The crew does not.</h2>
        <p>Capacity stays inside the building. The ambulance hears it on the radio, if it hears it at all.</p>
        <span class="scene-chip" style="--c:#CC8A2C"><i></i>Cause · no shared status</span>
      </div>
      <div class="scene">
        <span class="scene-k">03 <b>/ 03</b> Solution</span>
        <h2>Pre-alert.<br>Bed already held.</h2>
        <p>Crews see who can take them, send triage and complaint, and the hospital holds a bed before the doors open.</p>
        <span class="scene-chip" style="--c:#3F9142"><i></i>Right door · first time</span>
      </div>
    </div>

    <div class="rail" aria-hidden="true"><span>Problem</span><span>Why</span><span>Solution</span></div>
    <div class="scroll-cue" aria-hidden="true"><s></s>Scroll</div>

    <div class="stack">
      <div class="row">
        <a class="brand" href="/login">
          <span class="mark"><img src="/logo_tight.png" alt="HIP Logo"></span>
          <b>HIP</b>
        </a>

        <div class="menu" id="site-menu">
          <nav class="nav">
            <a class="n-item" href="#platform">
              <svg class="n-ico" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 2.5 2.5 6 10 9.5 17.5 6 10 2.5Z" stroke="#202940" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M2.5 10 10 13.5 17.5 10M2.5 14 10 17.5 17.5 14" stroke="#202940" stroke-width="1.7" stroke-linejoin="round"/>
              </svg>
              <span>Platform</span>
            </a>
            <a class="n-item" href="#how">
              <svg class="n-ico" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="7.4" height="7.4" rx="1.7" stroke="#202940" stroke-width="1.7"/>
                <rect x="11.6" y="1" width="7.4" height="7.4" rx="1.7" stroke="#202940" stroke-width="1.7"/>
                <rect x="1" y="11.6" width="7.4" height="7.4" rx="1.7" stroke="#202940" stroke-width="1.7"/>
                <rect x="11.6" y="11.6" width="7.4" height="7.4" rx="1.7" stroke="#202940" stroke-width="1.7"/>
              </svg>
              <span>Why</span>
            </a>
            <a class="n-item" href="#impact">
              <svg class="n-ico" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 17V3M3 17h14" stroke="#202940" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M6.6 17v-4M10.5 17V8M14.4 17v-6" stroke="#202940" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <span>Impact</span>
            </a>
            <a class="n-item" href="#founders">
              <svg class="n-ico" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="8" cy="7.4" r="2.7" stroke="#202940" stroke-width="1.7"/>
                <path d="M3 17v-.7A3.6 3.6 0 0 1 6.6 12.7h2.8A3.6 3.6 0 0 1 13 16.3V17" stroke="#202940" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M14.4 5.3a2.6 2.6 0 0 1 0 5.1M18 17v-.6a3.4 3.4 0 0 0-2.5-3.3" stroke="#202940" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <span>Founders</span>
            </a>
          </nav>
        </div>

        <button class="burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="site-menu"><i></i><i></i></button>

        <a class="cta" href="/login">
          <span>Open app</span>
          <span class="knob">
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m6.6 3.6 6 5.4-6 5.4" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </a>
      </div>

      <div class="hero-blk">
        <p class="eyebrow">Ambulance routing</p>
        <h1>
          <span>The right door.</span><br>
          <span>The first time.</span>
        </h1>
        <div class="tagrow">
          <span class="play">
            <svg viewBox="0 0 13 14" fill="none" aria-hidden="true"><path d="M1.4 1.3 11.6 7 1.4 12.7z" fill="#0b1526"/></svg>
          </span>
          <span class="tag">Who can take them, before they roll.</span>
        </div>
      </div>

      <div class="row">
        <div class="stats">
          <div class="stat">
            <span class="num">15m</span>
            <span class="lbl">Who is<br>due at<br>the door</span>
          </div>
          <span class="slash"></span>
          <div class="stat">
            <span class="num">0</span>
            <span class="lbl">Patient data<br>on the board</span>
          </div>
        </div>
        <a class="meet" href="/login">
          <span class="thumb"><img alt="" src="/main-hospital.jpg"></span>
          <b>Try it</b>
          <span class="knob">
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m6.6 3.6 6 5.4-6 5.4" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </a>
      </div>
    </div>
  </div>
</div>
</section>

<main class="s" id="content">

  <!-- Trust strip -->
  <section class="s-trust">
    <div class="s-wrap">
      <p>What every ambulance company sees</p>
      <div class="s-units">
        <span>Emergency</span><span>ICU</span><span>Inpatient</span><span>Operating rooms</span><span>Trauma</span><span>Stroke</span>
      </div>
    </div>
  </section>

  <!-- Platform -->
  <section class="s-platform-rdmd" id="platform">
    <div class="s-wrap">
      <div class="platform-top">
        <div class="platform-copy-box">
          <span class="s-eyebrow">What it does</span>
          <h2 class="platform-title">Before they pick a door</h2>
        </div>
      </div>

      <div class="platform-grid">
        <article class="platform-card">
          <span class="platform-no">01</span>
          <h3>Pre-alert</h3>
          <p>From the road. Triage, complaint, and ETA. The hospital answers before the doors open.</p>
        </article>
        <article class="platform-card">
          <span class="platform-no">02</span>
          <h3>Hold a bed</h3>
          <p>Accept, and that bed is held on the live map. It is not offered to the next arrival.</p>
        </article>
        <article class="platform-card">
          <span class="platform-no">03</span>
          <h3>You decide</h3>
          <p>A person answers every ambulance. Accept holds the bed; divert sends the crew to the best partner.</p>
        </article>
        <article class="platform-card">
          <span class="platform-no">04</span>
          <h3>Right door</h3>
          <p>Triage and complaint rank every hospital. Stroke, trauma, and STEMI go where that unit can take them.</p>
        </article>
        <article class="platform-card">
          <span class="platform-no">05</span>
          <h3>Live map</h3>
          <p>Emergency, ICU, wards, and ORs on a live map: the surgery in progress, the bed being cleaned.</p>
        </article>
        <article class="platform-card">
          <span class="platform-no">06</span>
          <h3>Open API</h3>
          <p>No patient data. FHIR for hospital systems. Webhooks so any ambulance company can plug in.</p>
        </article>
      </div>
    </div>
  </section>

  <!-- Workflow -->
  <section class="s-sec s-white" id="how">
    <div class="s-wrap">
      <header class="s-head center rv">
        <span class="s-eyebrow">Why</span>
        <h2 class="s-h2">The second trip</h2>
        <p class="s-lede">A radio call does not reach every ambulance company before the truck is already committed.</p>
      </header>
      <div class="s-steps">
        <div class="s-step rv">
          <span class="s-step-n">WHY 01</span>
          <span class="s-step-line" aria-hidden="true"></span>
          <h3>The door looks open</h3>
          <p>The emergency room can still be accepting while the ICU or the stroke bed this patient needs is full.</p>
        </div>
        <div class="s-step rv">
          <span class="s-step-n">WHY 02</span>
          <span class="s-step-line" aria-hidden="true"></span>
          <h3>The truck is rolling</h3>
          <p>Diversion that arrives after the crew has chosen means the patient has to go somewhere else.</p>
        </div>
        <div class="s-step rv">
          <span class="s-step-n">WHY 03</span>
          <span class="s-step-line" aria-hidden="true"></span>
          <h3>Many companies, one status</h3>
          <p>A call to one dispatcher is not a status every crew can read. Publish it once.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Cinematic banner -->
  <section class="s-banner" aria-label="They find out at the bay">
    <video class="s-bgvid" autoplay muted loop playsinline preload="metadata" poster="/videos/surgery.jpg" aria-hidden="true">
      <source src="/videos/surgery.mp4" type="video/mp4"></video>
    <div class="s-bgtint"></div>
    <div class="s-wrap rv">
      <span class="s-eyebrow">The problem</span>
      <h2>They find out at the bay.</h2>
      <p>A hospital that cannot take them should have said so while they were still on the road.</p>
    </div>
  </section>

  <!-- Product showcase -->
  <section class="s-sec s-alt">
    <div class="s-wrap s-show">
      <div class="rv">
        <span class="s-eyebrow">The solution</span>
        <h2 class="s-h2">Send them to a door that can.</h2>
        <p class="s-lede">Live capacity in every unit, a pre-alert from the road, and a bed held before arrival.</p>
        <ul class="s-list">
          <li><span class="s-check"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4"/></svg></span><div><b>Every unit</b>Emergency, ICU, inpatient beds, and operating rooms. Not only whether the ER is open.</div></li>
          <li><span class="s-check"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4"/></svg></span><div><b>Pre-alert</b>Triage and complaint from the road. Accept, and a bed is held on the map.</div></li>
          <li><span class="s-check"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4"/></svg></span><div><b>Open to any company</b>A public board with no patient data, plus webhooks when the status changes.</div></li>
          <li><span class="s-check"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4"/></svg></span><div><b>Ask the hospital</b>An AI assistant on the live database: who still needs an answer, which bed fits the next stroke.</div></li>
        </ul>
        <div class="s-btns">
          <a class="s-btn s-btn-dark" href="/login">Open the app <i><svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m6.6 3.6 6 5.4-6 5.4" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></i></a>
        </div>
      </div>
      <div class="s-mock rv" aria-hidden="true">
        <div class="s-mock-in">
          <div class="s-mock-bar"><i></i><i></i><i></i><span>HIP Regional Network · incoming</span><em class="is-ok">Accepting</em></div>
          <div class="s-mock-body">
            <div class="s-beds">
              <b class="r"></b><b class="y"></b><b class="g"></b><b></b><b class="y"></b><b class="r"></b>
              <b class="g"></b><b></b><b class="y"></b><b class="g"></b><b class="r"></b><b></b>
              <b class="y"></b><b class="g"></b><b></b><b class="r"></b><b class="g"></b><b class="y"></b>
              <b></b><b class="r"></b><b class="g"></b><b class="y"></b><b></b><b class="g"></b>
            </div>
            <div class="s-side">
              <div class="s-kpi"><small>Due in 15 min</small><strong>3</strong><div class="bar"><i style="width:60%"></i></div></div>
              <div class="s-kpi"><small>ED beds open</small><strong>4</strong><div class="bar"><i style="width:33%"></i></div></div>
              <div class="s-kpi"><small>ICU open</small><strong>2 / 12</strong><div class="bar"><i style="width:17%"></i></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Impact -->
  <section class="s-sec s-vid dark" id="impact">
    <video class="s-bgvid" autoplay muted loop playsinline preload="metadata" poster="/videos/ambulance.jpg" aria-hidden="true">
      <source src="/videos/ambulance.mp4" type="video/mp4"></video>
    <div class="s-bgtint"></div>
    <div class="s-wrap">
      <header class="s-head rv">
        <span class="s-eyebrow">Why it matters</span>
        <h2 class="s-h2">The first door should be the right one.</h2>
        <p class="s-lede">Minutes disappear when an ambulance arrives somewhere that has to send them on.</p>
      </header>
      <div class="s-metrics">
        <div class="s-metric rv"><strong>15m</strong><span>Who is due at this door, on one screen</span></div>
        <div class="s-metric rv"><strong>Held</strong><span>A bed, before the doors open</span></div>
        <div class="s-metric rv"><strong>0</strong><span>Patient records on the public board</span></div>
        <div class="s-metric rv"><strong>1</strong><span>Status every ambulance company reads</span></div>
      </div>
    </div>
  </section>

  <!-- Final CTA -->
  <section class="s-sec s-white">
    <div class="s-wrap">
      <div class="s-final rv">
        <img class="s-bgvid" src="/videos/cta-0926.jpg" alt="" aria-hidden="true">
        <div class="s-bgtint"></div>
        <span class="s-eyebrow">Try it</span>
        <h2 class="s-h2">Answer the next ambulance</h2>
        <p class="s-lede">Open HIP. See who is coming, and whether this door can take them.</p>
        <div class="s-btns">
          <a class="s-btn s-btn-dark" href="/login">Open app <i><svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m6.6 3.6 6 5.4-6 5.4" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></i></a>
          <a class="s-btn s-btn-ghost" href="#platform">See how it works</a>
        </div>
      </div>
    </div>
  </section>

  <!-- Founders -->
  <section class="s-sec s-alt s-founders" id="founders">
    <div class="s-wrap">
      <header class="s-head center rv">
        <span class="s-eyebrow">The team</span>
        <h2 class="s-h2">Hospital Intelligence Platform (HIP)</h2>
        <p class="s-lede">So a crew does not learn the hospital is full when they are already at the door.</p>
      </header>
      <figure class="founders-photo rv">
        <img src="/founders.webp" alt="The HIP Clinical Operations team" loading="lazy">
      </figure>
    </div>
  </section>

  <!-- Footer -->
  <footer class="site-footer">
    <div class="footer-media" aria-hidden="true">
      <video class="footer-bg" autoplay muted loop playsinline preload="auto" poster="https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/4f690bd1-881a-4192-82f2-d714d34c8fb9.png">
        <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260901_122529_931c22c8-8d2d-47c0-ad51-b97f56a91e42.mp4" type="video/mp4">
      </video>
    </div>
    <div class="footer-inner">
      <div class="footer-grid">
        <div class="f-brand">
          <div class="brand-lockup">
            <img class="brand-mark" src="/logo_tight.png" alt="HIP">
            <p class="brand-name">HIP</p>
          </div>
          <p class="brand-blurb">Live hospital capacity for ambulance crews. The right door, the first time. Hospital Intelligence Platform.</p>
          <ul class="contact-list">
            <li>
              <svg class="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v.4l8 5 8-5V6H4Zm16 2.7-8 5-8-5V18h16V8.7Z"/></svg>
              <a href="mailto:team@HIP.health">team@HIP.health</a>
            </li>
            <li>
              <svg class="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 2.5c.6 0 1.1.4 1.3 1l1 3.2a1.4 1.4 0 0 1-.35 1.4L8 9.3a12 12 0 0 0 6.7 6.7l1.2-1.2a1.4 1.4 0 0 1 1.4-.35l3.2 1a1.4 1.4 0 0 1 1 1.3v3A2.5 2.5 0 0 1 19 22 17 17 0 0 1 2 5 2.5 2.5 0 0 1 4.5 2.5h2.1Z"/></svg>
              <a href="tel:+15550000000">+1 (555) 000-0000</a>
            </li>
            <li>
              <svg class="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 1 7 7c0 4.6-5.3 11.7-6.3 12.9a.9.9 0 0 1-1.4 0C10.3 20.7 5 13.6 5 9a7 7 0 0 1 7-7Zm0 4.6A2.4 2.4 0 1 0 12 11.4 2.4 2.4 0 0 0 12 6.6Z"/></svg>
              <span>HIP Medical Center</span>
            </li>
          </ul>
        </div>

        <nav class="col" aria-label="Platform">
          <p class="col-title">Platform</p>
          <ul class="link-list">
            <li><a href="/login">Overview</a></li>
            <li><a href="/login">Live Map</a></li>
            <li><a href="/login">Ambulances</a></li>
            <li><a href="/login">Open Data</a></li>
            <li><a href="/command-center">Command Center</a></li>
          </ul>
        </nav>

        <nav class="col" aria-label="Product">
          <p class="col-title">Product</p>
          <ul class="link-list">
            <li><a href="#platform">Before they pick</a></li>
            <li><a href="#how">The second trip</a></li>
            <li><a href="#impact">Impact</a></li>
            <li><a href="#founders">Founders</a></li>
          </ul>
        </nav>

        <nav class="col" aria-label="Resources">
          <p class="col-title">Resources</p>
          <ul class="link-list">
            <li><a href="#top">Documentation</a></li>
            <li><a href="#top">Support</a></li>
            <li><a href="#top">Status</a></li>
            <li><a href="mailto:team@HIP.health">Talk To Us</a></li>
          </ul>
        </nav>

        <div class="newsletter">
          <p class="col-title">Stay In The Loop</p>
          <p>Updates when the regional board and the open API for ambulance companies change.</p>
          <form class="subscribe" onsubmit="return false">
            <label class="sr-only" for="nl-email">Email address</label>
            <input id="nl-email" type="email" name="email" placeholder="Leave your email" autocomplete="email" required>
            <button type="submit" aria-label="Subscribe">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>
            </button>
          </form>
        </div>
      </div>

      <div class="footer-bottom">
        <div class="socials">
          <a href="#" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 9V7.2c0-.8.2-1.2 1.3-1.2H17V3.2C16.6 3.1 15.5 3 14.4 3 11.8 3 10 4.6 10 7v2H7.5v3H10v9h3v-9h2.6l.4-3H13Z"/></svg></a>
          <a href="#" aria-label="Twitter"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 5.8c-.7.3-1.5.5-2.3.6a4 4 0 0 0 1.8-2.2c-.8.5-1.7.8-2.6 1a4 4 0 0 0-6.9 3.6A11.4 11.4 0 0 1 3.8 4.6a4 4 0 0 0 1.2 5.4c-.6 0-1.2-.2-1.8-.5a4 4 0 0 0 3.2 4c-.5.1-1.1.2-1.7.1a4 4 0 0 0 3.7 2.8A8 8 0 0 1 2 19.5 11.3 11.3 0 0 0 8.1 22c7.5 0 11.5-6.2 11.5-11.5v-.5A8 8 0 0 0 22 5.8Z"/></svg></a>
          <a href="#" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9a3.6 3.6 0 0 1-.9-1.4c-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 3.6a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4Zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.4-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z"/></svg></a>
          <a href="#" aria-label="LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.9 5A1.9 1.9 0 1 1 3 5a1.9 1.9 0 0 1 3.9 0ZM3.3 8.4h3.3V21H3.3V8.4Zm5.4 0h3.1v1.7h.05c.44-.8 1.5-1.7 3.1-1.7 3.3 0 3.9 2.1 3.9 4.9V21h-3.3v-5.6c0-1.3 0-3-1.9-3s-2.2 1.4-2.2 2.9V21H8.7V8.4Z"/></svg></a>
        </div>
        <nav class="legal" aria-label="Legal">
          <a href="#">Privacy Notice</a>
          <a href="#">Terms &amp; Policies</a>
          <a href="#">Cookie Notice</a>
        </nav>
      </div>
    </div>
  </footer>
</main>`;

export default function Landing(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isAuthenticated, claims } = useAuth();

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const handleLinkClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a, button');
      if (!target) return;

      const href = target.getAttribute('href');
      if (
        href === '/app.html' ||
        href === '/login' ||
        href === '/dashboard/clinical' ||
        target.classList.contains('cta') ||
        target.classList.contains('meet')
      ) {
        e.preventDefault();
        if (isAuthenticated) {
          if (claims?.role === 'CLEANING_CREW') {
            navigate('/dashboard/housekeeping');
          } else if (claims?.role === 'ADMIN') {
            navigate('/dashboard/admin');
          } else {
            navigate('/dashboard/clinical');
          }
        } else {
          navigate('/login');
        }
      } else if (href === '#login' || target.getAttribute('data-action') === 'login') {
        e.preventDefault();
        navigate('/login');
      }
    };

    root.addEventListener('click', handleLinkClick);

    const b = root.querySelector('.burger');
    const m = root.querySelector('#site-menu');
    const setMenu = (open: boolean) => {
      if (!b || !m) return;
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) m.setAttribute('data-open', '');
      else m.removeAttribute('data-open');
    };

    const handleBurgerClick = (e: Event) => {
      e.stopPropagation();
      if (!b) return;
      setMenu(b.getAttribute('aria-expanded') !== 'true');
    };

    if (b) b.addEventListener('click', handleBurgerClick);

    const track = root.querySelector('#top') as HTMLElement | null;
    const card = track?.querySelector('.card') as HTMLElement | null;
    const canvas = track?.querySelector('.bgc') as HTMLCanvasElement | null;
    let animFrameId: number;

    if (track && card && canvas && canvas.getContext) {
      const ctx = canvas.getContext('2d');
      const scenes = Array.from(track.querySelectorAll('.scene')) as HTMLElement[];
      const rail = track.querySelector('.rail');
      const ticks = rail ? Array.from(rail.children) : [];
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

      const N = 121;
      const frames: (HTMLImageElement | null)[] = new Array(N).fill(null);
      let shown = -1;
      let want = 0;
      let target = 0;
      let smooth = 0;
      let dirty = true;
      const SEG = [
        [0.17, 0.25, 0.38, 0.45],
        [0.43, 0.51, 0.63, 0.7],
        [0.68, 0.76, 0.9, 0.97],
      ];

      const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
      const sstep = (a: number, b: number, v: number) => {
        const x = clamp((v - a) / (b - a));
        return x * x * (3 - 2 * x);
      };
      const src = (i: number) => '/frames/f_' + String(i + 1).padStart(3, '0') + '.webp';

      const order: number[] = [];
      const seen: Record<number, boolean> = {};
      [16, 8, 4, 2, 1].forEach((step) => {
        for (let i = 0; i < N; i += step) {
          if (!seen[i]) {
            seen[i] = true;
            order.push(i);
          }
        }
      });
      if (!seen[N - 1]) order.push(N - 1);

      let q = 0;
      let inflight = 0;
      const pump = () => {
        while (inflight < 6 && q < order.length) {
          const i = order[q++];
          inflight++;
          const im = new Image();
          im.decoding = 'async';
          im.onload = () => {
            frames[i] = im;
            inflight--;
            dirty = true;
            if (i === 0 && canvas) canvas.classList.add('ready');
            pump();
          };
          im.onerror = () => {
            inflight--;
            pump();
          };
          im.src = src(i);
        }
      };
      pump();

      const size = () => {
        if (!card || !canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.round(card.clientWidth * dpr);
        const h = Math.round(card.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          shown = -1;
          dirty = true;
        }
      };

      const nearest = (i: number) => {
        if (frames[i]) return i;
        for (let d = 1; d < N; d++) {
          if (frames[i - d]) return i - d;
          if (frames[i + d]) return i + d;
        }
        return -1;
      };

      const draw = () => {
        if (!ctx || !canvas) return;
        const i = nearest(want);
        if (i < 0 || i === shown) return;
        const im = frames[i];
        if (!im) return;
        const cw = canvas.width;
        const ch = canvas.height;
        const s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
        const w = im.naturalWidth * s;
        const h = im.naturalHeight * s;
        ctx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h);
        shown = i;
      };

      const progress = () => {
        if (!track) return 0;
        const r = track.getBoundingClientRect();
        const dist = track.offsetHeight - window.innerHeight;
        return dist > 0 ? clamp(-r.top / dist) : 0;
      };

      const frame = () => {
        target = progress();
        smooth = reduce.matches ? target : smooth + (target - smooth) * 0.12;
        if (Math.abs(target - smooth) < 0.0004) smooth = target;
        const p = smooth;

        want = Math.round(p * (N - 1));
        size();
        if (dirty || shown !== want) {
          draw();
          dirty = false;
        }
        const zoom = 1 + 0.32 * sstep(0, 1, p);
        if (canvas) canvas.style.transform = 'scale(' + zoom.toFixed(4) + ')';

        const ho = 1 - sstep(0.015, 0.14, p);
        if (card) {
          card.style.setProperty('--hero-o', ho.toFixed(3));
          card.style.setProperty('--hero-y', (-(1 - ho) * 42).toFixed(1) + 'px');
          card.classList.toggle('hero-gone', ho < 0.02);
        }

        let active = -1;
        scenes.forEach((el, k) => {
          const g = SEG[k];
          const a = sstep(g[0], g[1], p);
          const b = sstep(g[2], g[3], p);
          const o = a * (1 - b);
          el.style.opacity = o.toFixed(3);
          el.style.setProperty('--sy', ((1 - a) * 34 - b * 34).toFixed(1) + 'px');
          if (o > 0.5) active = k;
        });

        if (rail) {
          rail.classList.toggle('on', p > 0.16 && p < 0.97);
          ticks.forEach((t, k) => {
            (t as HTMLElement).classList.toggle('on', k === active);
          });
        }

        animFrameId = requestAnimationFrame(frame);
      };

      const handleResize = () => {
        dirty = true;
      };
      window.addEventListener('resize', handleResize);
      animFrameId = requestAnimationFrame(frame);

      const rvElements = root.querySelectorAll('.rv');
      const rvObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('in');
              rvObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
      );
      rvElements.forEach((el) => rvObserver.observe(el));

      const vids = Array.from(root.querySelectorAll<HTMLVideoElement>('.s-bgvid'));
      const videoObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const v = entry.target as HTMLVideoElement;
            if (entry.isIntersecting) {
              v.parentElement?.classList.remove('is-paused');
              v.play().catch(() => {});
            } else {
              v.parentElement?.classList.add('is-paused');
              try {
                v.pause();
                v.currentTime = 0;
              } catch {}
            }
          });
        },
        { rootMargin: '140px 0px 140px 0px', threshold: 0.12 }
      );
      vids.forEach((v) => {
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        videoObserver.observe(v);
      });

      return () => {
        root.removeEventListener('click', handleLinkClick);
        if (b) b.removeEventListener('click', handleBurgerClick);
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animFrameId);
        rvObserver.disconnect();
        videoObserver.disconnect();
      };
    }
  }, [navigate, isAuthenticated, claims]);

  return (
    <div
      ref={containerRef}
      className="landing-wrapper"
      dangerouslySetInnerHTML={{ __html: LANDING_HTML }}
    />
  );
}

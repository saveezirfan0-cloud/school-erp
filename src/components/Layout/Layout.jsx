import React, { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import QuickAdd from "./QuickAdd";
import CommandPalette from "./CommandPalette";

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handler = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    // Set correct initial state
    const mobile = window.innerWidth <= 768;
    setIsMobile(mobile);
    setSidebarOpen(!mobile);

    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Ctrl/Cmd+K opens the page search from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-close on mobile when navigating
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", position: "relative" }}>

      {/* Dark overlay — mobile only when sidebar open */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 98, cursor: "pointer",
          }}
        />
      )}

      {/* Sidebar wrapper */}
      <div style={{
        position: isMobile ? "fixed" : "relative",
        top: 0, left: 0,
        height: "100vh",
        zIndex: isMobile ? 99 : "auto",
        flexShrink: 0,
        // Mobile: slide in/out. Desktop: collapse width.
        transform: isMobile
          ? (sidebarOpen ? "translateX(0)" : "translateX(-260px)")
          : "none",
        width: isMobile ? 240 : (sidebarOpen ? 240 : 0),
        overflow: "hidden",
        transition: isMobile
          ? "transform 0.25s ease"
          : "width 0.25s ease",
      }}>
        <Sidebar onClose={isMobile ? () => setSidebarOpen(false) : null} onSearch={() => setPaletteOpen(true)} />
      </div>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
      }}>
        <Navbar onMenuClick={() => setSidebarOpen(prev => !prev)} />
        <main style={{
          flex: 1,
          overflow: "auto",
          padding: "16px",
          background: "#f8fafc",
        }}>
          <Outlet />
        </main>
      </div>

      <QuickAdd />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

    </div>
  );
}
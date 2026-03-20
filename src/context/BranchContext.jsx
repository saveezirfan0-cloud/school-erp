import React, { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const location = useLocation();

  useEffect(() => {
    const handler = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname]);

  const handleClose = () => { if (isMobile) setSidebarOpen(false); };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", position: "relative" }}>
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 98, cursor: "pointer" }} />
      )}
      <div style={{
        position: isMobile ? "fixed" : "relative",
        top: 0, left: 0, height: "100vh", zIndex: 99, flexShrink: 0,
        transform: isMobile ? (sidebarOpen ? "translateX(0)" : "translateX(-260px)") : "translateX(0)",
        transition: isMobile ? "transform 0.25s ease" : "none",
      }}>
        <Sidebar onClose={isMobile ? handleClose : null} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <Navbar onMenuClick={() => setSidebarOpen(prev => !prev)} />
        <main style={{ flex: 1, overflow: "auto", padding: "16px", background: "#f8fafc" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
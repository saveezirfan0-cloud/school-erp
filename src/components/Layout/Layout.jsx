import React, { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handler = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

      {/* Dark overlay — mobile only */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 98,
          }}
        />
      )}

      {/* Sidebar */}
      <div style={{
        position: isMobile ? "fixed" : "relative",
        top: 0, left: 0, bottom: 0,
        zIndex: 99,
        transform: isMobile ? `translateX(${sidebarOpen ? "0" : "-100%"})` : "none",
        transition: "transform 0.25s ease",
        flexShrink: 0,
        height: "100vh",
      }}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
      }}>
        <Navbar onMenuClick={() => setSidebarOpen(true)} />
        <main style={{
          flex: 1,
          overflow: "auto",
          padding: "16px",
          background: "#f8fafc",
        }}>
          <Outlet />
        </main>
      </div>

    </div>
  );
}
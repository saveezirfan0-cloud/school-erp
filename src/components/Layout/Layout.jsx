import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <div style={{
        position: window.innerWidth <= 768 ? "fixed" : "relative",
        left: window.innerWidth <= 768 ? (sidebarOpen ? 0 : -260) : 0,
        top: 0, bottom: 0, zIndex: 100,
        transition: "left 0.25s ease",
        flexShrink: 0,
      }}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <Navbar onMenuClick={() => setSidebarOpen(true)} />
        <main style={{ flex: 1, overflow: "auto", padding: "16px", background: "#f8fafc" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
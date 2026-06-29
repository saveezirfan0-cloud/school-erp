import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

// Normalize a Supabase user into the shape the app expects from
// Firebase (it reads `user.uid` and `user.email`).
function shapeUser(sUser) {
  if (!sUser) return null;
  return { ...sUser, uid: sUser.id, email: sUser.email };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initial session.
    supabase.auth.getSession().then(({ data }) => {
      setUser(shapeUser(data?.session?.user || null));
      setLoading(false);
    });

    // Live auth state (replaces onAuthStateChanged).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(shapeUser(session?.user || null));
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const login = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const logout = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

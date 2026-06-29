import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
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
    let mounted = true;

    // Initial session.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(shapeUser(data?.session?.user || null));
      setLoading(false);
    });

    // Live auth state (replaces onAuthStateChanged).
    // IMPORTANT: Supabase fires TOKEN_REFRESHED / SIGNED_IN events when
    // you return to a backgrounded tab. If we blindly call setUser on
    // every event we create a NEW user object, which remounts the whole
    // app and wipes any in-progress form state. So we only update state
    // when the actual user id changes (login / logout / switch), and
    // ignore pure token refreshes for the same user.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const nextId = session?.user?.id || null;

      setUser((prev) => {
        const prevId = prev?.uid || null;
        if (prevId === nextId) {
          // Same user (or still logged out) — keep the existing object
          // reference so nothing downstream remounts.
          return prev;
        }
        return shapeUser(session?.user || null);
      });
      setLoading(false);
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const login = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const logout = useCallback(() => supabase.auth.signOut(), []);

  // Memoize so the context value is stable across renders that don't
  // change user/loading.
  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

import React from "react";
import { useUser } from "../context/UserContext";

export default function ProtectedSection({ permission, fallback = null, children }) {
  const { can } = useUser();
  if (!can(permission)) return fallback;
  return children;
}
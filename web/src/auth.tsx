import { createContext, useContext, useState, type ReactNode } from "react";
import { api, getToken, setToken, clearToken } from "./api";

interface AuthState {
  token: string | null;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  token: null,
  username: null,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());
  const [username, setUsername] = useState<string | null>(null);

  const login = async (u: string, p: string) => {
    const res = await api.post<{ token: string; username: string }>("/api/auth/login", {
      username: u,
      password: p,
    });
    setToken(res.token);
    setTokenState(res.token);
    setUsername(res.username);
  };

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* ignore */
    }
    clearToken();
    setTokenState(null);
    setUsername(null);
  };

  return (
    <AuthContext.Provider value={{ token, username, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

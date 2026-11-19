import { createContext, useContext } from 'react';
import { authLayout } from './layout';
export const AuthLayoutContext = createContext<ReturnType<typeof authLayout> | null>(null);
export const useAuthLayout = () => useContext(AuthLayoutContext);

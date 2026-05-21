import { Link } from "react-router-dom";
import logo from "@/assets/nsk-logo.png";

export const Logo = ({ size = 36 }: { size?: number }) => (
  <Link to="/" className="flex items-center gap-2 group">
    <img src={logo} width={size} height={size} alt="NeuroShield Kids" className="transition-smooth group-hover:scale-110" />
    <span className="font-bold text-lg leading-none">
      <span className="text-foreground">Neuro</span>
      <span className="text-gradient">Shield</span>
      <span className="text-secondary"> Kids</span>
    </span>
  </Link>
);

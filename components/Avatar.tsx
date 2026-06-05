"use client";

import { initials } from "@/lib/utils";

type Props = {
  name: string;
  color: string;
  size?: "sm" | "md" | "lg";
  emoji?: string;
};

const sizes = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

export default function Avatar({ name, color, size = "md", emoji }: Props) {
  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`}
      style={{ backgroundColor: emoji ? undefined : color, background: emoji ? color : undefined }}
      aria-label={name}
    >
      {emoji ? (
        <span className="text-lg leading-none">{emoji}</span>
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}

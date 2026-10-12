"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

export function PasswordInput(props: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <Input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        aria-controls={props.id}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {visible ? "Hide password" : "Show password"}
      </button>
    </div>
  );
}

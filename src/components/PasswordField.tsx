"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function PasswordField() {
  const [visible, setVisible] = useState(false);

  return <div className="auth-password-field">
    <label htmlFor="login-password">Пароль</label>
    <div className="password-input-wrap">
      <input
        id="login-password"
        name="password"
        type={visible ? "text" : "password"}
        autoComplete="current-password"
        required
      />
      <button
        type="button"
        className="password-visibility"
        aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
        aria-pressed={visible}
        aria-controls="login-password"
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </div>
  </div>;
}

import { forwardRef, type TextareaHTMLAttributes } from "react";
import styles from "./textarea.module.css";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      data-slot="textarea"
      ref={ref}
      className={[styles.textarea, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
});

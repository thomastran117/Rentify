import AppError from "./app.error";

class EmailChangeSameAddressError extends AppError {
  constructor(
    message = "That is already the email address on this account.",
    details?: unknown,
  ) {
    super(message, 400, "EMAIL_CHANGE_SAME_ADDRESS", details);
    this.name = "EmailChangeSameAddressError";
  }
}

export default EmailChangeSameAddressError;
export { EmailChangeSameAddressError };

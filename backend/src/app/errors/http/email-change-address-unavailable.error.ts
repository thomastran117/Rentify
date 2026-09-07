import AppError from "./app.error";

class EmailChangeAddressUnavailableError extends AppError {
  constructor(
    message = "That email address is not available.",
    details?: unknown,
  ) {
    super(message, 409, "EMAIL_CHANGE_ADDRESS_UNAVAILABLE", details);
    this.name = "EmailChangeAddressUnavailableError";
  }
}

export default EmailChangeAddressUnavailableError;
export { EmailChangeAddressUnavailableError };

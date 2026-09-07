import AppError from "./app.error";

class EmailChangeNotPendingError extends AppError {
  constructor(
    message = "No email change is in progress. Start a new request.",
    details?: unknown,
  ) {
    super(message, 409, "EMAIL_CHANGE_NOT_PENDING", details);
    this.name = "EmailChangeNotPendingError";
  }
}

export default EmailChangeNotPendingError;
export { EmailChangeNotPendingError };

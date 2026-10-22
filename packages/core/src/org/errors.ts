/** Domain errors surfaced to the UI/API with safe messages. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

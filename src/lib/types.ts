/**
 * Shared API/domain types for the otti backend.
 */

/** A logged-in user as returned by the backend. */
export interface User {
  id: number;
  email: string;
  display_name: string;
  is_admin: boolean;
}

/**
 * Response shape of `POST /auth/login` for mobile clients (X-Client: mobile).
 * It is a FLAT object: the user fields plus a top-level bearer `token`.
 */
export interface LoginResponse extends User {
  token: string;
}

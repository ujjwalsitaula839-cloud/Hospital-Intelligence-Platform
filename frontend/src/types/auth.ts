export type UserRole = "DOCTOR" | "NURSE" | "CLEANING_CREW" | "PHARMACY" | "ADMIN";

export interface PersonnelProfile {
    personnel_id: number;
    username: string;
    email: string;
    full_name: string;
    role: UserRole;
    department: string;
    is_active?: boolean;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface RegisterRequest {
    username: string;
    email: string;
    password: string;
    full_name: string;
    role: UserRole;
    department: string;
}

export interface AuthResponse {
    access_token: string;
    token_type: string;
    personnel_id: number;
    username: string;
    full_name: string;
    role: UserRole;
    department: string;
}

export interface JWTPayload {
    sub: string;
    username?: string;
    role?: UserRole;
    department?: string;
    full_name?: string;
    exp: number;
}

import { describe, it, expect, vi, afterEach } from "vitest";
import { arenaLocalOnly, isLoopbackRemoteAddress } from "./localOnly.ts";
import type { Request, Response } from "express";

describe("isLoopbackRemoteAddress", () => {
  it("accepts IPv4 / IPv6 loopback and mapped forms", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("::1")).toBe(true);
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("localhost")).toBe(true);
  });

  it("rejects LAN and missing addresses", () => {
    expect(isLoopbackRemoteAddress("192.168.1.10")).toBe(false);
    expect(isLoopbackRemoteAddress("10.0.0.5")).toBe(false);
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
  });
});

describe("arenaLocalOnly", () => {
  const prev = process.env.OLIVE_ARENA_ALLOW_REMOTE;

  afterEach(() => {
    if (prev === undefined) delete process.env.OLIVE_ARENA_ALLOW_REMOTE;
    else process.env.OLIVE_ARENA_ALLOW_REMOTE = prev;
  });

  function mockRes() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  }

  it("allows loopback clients", () => {
    delete process.env.OLIVE_ARENA_ALLOW_REMOTE;
    const next = vi.fn();
    const req = { socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
    const res = mockRes();
    arenaLocalOnly(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects non-loopback clients with 403", () => {
    delete process.env.OLIVE_ARENA_ALLOW_REMOTE;
    const next = vi.fn();
    const req = { socket: { remoteAddress: "192.168.0.2" } } as unknown as Request;
    const res = mockRes();
    arenaLocalOnly(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows remote when OLIVE_ARENA_ALLOW_REMOTE=true", () => {
    process.env.OLIVE_ARENA_ALLOW_REMOTE = "true";
    const next = vi.fn();
    const req = { socket: { remoteAddress: "192.168.0.2" } } as unknown as Request;
    const res = mockRes();
    arenaLocalOnly(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

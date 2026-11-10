import crypto from "node:crypto"

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"
const DIGITS = "23456789"
const ALPHABET = LETTERS + DIGITS
const MIN_LENGTH = 8
const MAX_LENGTH = 64

function pick(chars) {
  return chars[crypto.randomInt(chars.length)]
}

export function generatePassword(length = 16) {
  const size = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Number.parseInt(length, 10) || 16))
  const chars = [pick(LETTERS), pick(DIGITS)]
  while (chars.length < size) chars.push(pick(ALPHABET))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

export function validatePassword(password, current = "") {
  const value = String(password ?? "")
  if (!value) return "请输入新密码"
  if (value.length < MIN_LENGTH) return `密码至少需要 ${MIN_LENGTH} 位`
  if (value.length > MAX_LENGTH) return `密码不能超过 ${MAX_LENGTH} 位`
  if (/\s/.test(value)) return "密码不能包含空格"
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return "密码必须同时包含字母和数字"
  if (current && value === current) return "新密码不能与当前密码相同"
  return ""
}

import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

export default function SignIn() {
  const nav = useNavigate()
  useEffect(() => { nav('/settings') }, [nav])
  return null
}

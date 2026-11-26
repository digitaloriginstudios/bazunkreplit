import { useState, useEffect } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useCurrency, CURRENCIES, MARKET_COUNTRIES, type CurrencyCode } from "@/context/CurrencyContext";
import { CountrySetupModal, COUNTRY_STORAGE_KEY } from "@/components/CountrySetupModal";

export function UserCurrencySync() {
  const { user } = useAuth();
  const { getToken } = useClerkAuth();
  const { setCountry, setCurrency, countryCode, currency } = useCurrency();
  const [showModal, setShowModal] = useState(false);
  const [readyEmail, setReadyEmail] = useState("");
  const email = user?.email ?? "";
  useEffect(() => {
    let cancelled = false;
    setReadyEmail(""); setShowModal(false);
    if (!email) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const response = await fetch("/api/marketplace/preferences", {headers:{Authorization:"Bearer "+token}});
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        if (MARKET_COUNTRIES.some(c=>c.code===data.delivery_country)) {
          setCountry(data.delivery_country);
          localStorage.setItem(COUNTRY_STORAGE_KEY(email),data.delivery_country);
          if (Object.prototype.hasOwnProperty.call(CURRENCIES,data.preferred_currency)) setCurrency(data.preferred_currency as CurrencyCode);
          setReadyEmail(email);
        } else {
          const stored=localStorage.getItem(COUNTRY_STORAGE_KEY(email));
          if (stored && MARKET_COUNTRIES.some(c=>c.code===stored)) {setCountry(stored);setReadyEmail(email);}
          else if (stored!=="SKIP") setShowModal(true);
        }
      } catch { /* Local preferences remain usable if the server is unavailable. */ }
    })();
    return ()=>{cancelled=true;};
  },[email]);
  useEffect(()=>{
    if (!email || readyEmail!==email || showModal) return;
    let cancelled=false;
    const timer=setTimeout(async()=>{
      try {
        const token=await getToken();
        if (!token || cancelled) return;
        await fetch("/api/marketplace/preferences",{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({deliveryCountry:countryCode,preferredCurrency:currency.code})});
      } catch { /* Retry on the next preference change. */ }
    },350);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[email,readyEmail,showModal,countryCode,currency.code]);
  if (!email) return null;
  return <AnimatePresence>{showModal && <CountrySetupModal email={email} onDone={()=>{setShowModal(false);const stored=localStorage.getItem(COUNTRY_STORAGE_KEY(email));if(MARKET_COUNTRIES.some(c=>c.code===stored))setReadyEmail(email);}}/>}</AnimatePresence>;
}

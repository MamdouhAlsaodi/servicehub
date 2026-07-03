'use client';

// This page redirects to the services page since we use a modal for adding services
// In a more complex app, you might want a full page form

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewServicePage() {
  const router = useRouter();
  
  useEffect(() => {
    // Redirect to services page with modal open parameter
    router.replace('/dashboard/services?new=true');
  }, [router]);
  
  return null;
}

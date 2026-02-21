import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { AssignFixingTicketForm } from '../../components/support/AssignFixingTicketForm';

export function AssignFixingTicketPage() {
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { userProfile, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!userProfile) {
      navigate('/login');
      return;
    }
    if (userProfile.role === 'solution_owner') {
      navigate('/solution-admin');
      return;
    }
    if (['customer', 'customer_admin'].includes(userProfile.role || '')) {
      navigate(tenantSlug ? `/${tenantSlug}/admin` : '/');
      return;
    }
  }, [authLoading, userProfile, navigate, tenantSlug]);

  if (authLoading || !userProfile) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <AssignFixingTicketForm />
    </div>
  );
}

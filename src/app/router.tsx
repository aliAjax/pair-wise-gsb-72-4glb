import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { FlagsPage } from '@/pages/FlagsPage'
import { FlagEditorPage } from '@/pages/FlagEditorPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { DependenciesPage } from '@/pages/DependenciesPage'
import { RolloutPage } from '@/pages/RolloutPage'
import { AuditPage } from '@/pages/AuditPage'
import { ReportsPage } from '@/pages/ReportsPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'flags', element: <FlagsPage /> },
      { path: 'flags/new', element: <FlagEditorPage /> },
      { path: 'flags/:id', element: <FlagEditorPage /> },
      { path: 'review', element: <ReviewPage /> },
      { path: 'dependencies', element: <DependenciesPage /> },
      { path: 'rollout', element: <RolloutPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'reports', element: <ReportsPage /> },
    ],
  },
])

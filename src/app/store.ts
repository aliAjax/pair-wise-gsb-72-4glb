import { configureStore } from '@reduxjs/toolkit'
import { flagApi } from '@/services/flagApi'
import uiReducer from '@/app/uiSlice'

export const store = configureStore({
  reducer: {
    ui: uiReducer,
    [flagApi.reducerPath]: flagApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(flagApi.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

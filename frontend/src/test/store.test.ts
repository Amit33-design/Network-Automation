import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store/useAppStore'

// Reset store state before each test
beforeEach(() => {
  useAppStore.getState().reset()
})

describe('useAppStore', () => {
  it('has correct initial state', () => {
    const s = useAppStore.getState()
    expect(s.useCase).toBe('')
    expect(s.step).toBe(1)
    expect(s.scale).toBe('small')
    expect(s.redundancy).toBe('dual')
    expect(s.appTypes).toEqual([])
    expect(s.compliance).toEqual([])
    expect(s.devices).toEqual([])
  })

  it('setUseCase updates use case', () => {
    useAppStore.getState().setUseCase('gpu')
    expect(useAppStore.getState().useCase).toBe('gpu')
  })

  it('nextStep increments step', () => {
    useAppStore.getState().setStep(1)
    useAppStore.getState().nextStep()
    expect(useAppStore.getState().step).toBe(2)
  })

  it('nextStep caps at 6', () => {
    useAppStore.getState().setStep(6)
    useAppStore.getState().nextStep()
    expect(useAppStore.getState().step).toBe(6)
  })

  it('prevStep decrements step', () => {
    useAppStore.getState().setStep(3)
    useAppStore.getState().prevStep()
    expect(useAppStore.getState().step).toBe(2)
  })

  it('prevStep floors at 1', () => {
    useAppStore.getState().setStep(1)
    useAppStore.getState().prevStep()
    expect(useAppStore.getState().step).toBe(1)
  })

  it('setSiteName and setSiteCode work', () => {
    useAppStore.getState().setSiteName('NYC DC')
    useAppStore.getState().setSiteCode('NYC')
    expect(useAppStore.getState().siteName).toBe('NYC DC')
    expect(useAppStore.getState().siteCode).toBe('NYC')
  })

  it('setScale and setRedundancy work', () => {
    useAppStore.getState().setScale('large')
    useAppStore.getState().setRedundancy('single')
    expect(useAppStore.getState().scale).toBe('large')
    expect(useAppStore.getState().redundancy).toBe('single')
  })

  it('setAppTypes replaces app types', () => {
    useAppStore.getState().setAppTypes(['voice', 'video'])
    expect(useAppStore.getState().appTypes).toEqual(['voice', 'video'])
  })

  it('setCompliance replaces compliance list', () => {
    useAppStore.getState().setCompliance(['PCI', 'SOC2'])
    expect(useAppStore.getState().compliance).toEqual(['PCI', 'SOC2'])
  })

  it('setLinkDistance updates a single key', () => {
    useAppStore.getState().setLinkDistance('spine-leaf', 250)
    expect(useAppStore.getState().linkDistances['spine-leaf']).toBe(250)
    expect(useAppStore.getState().linkDistances['wan-edge']).toBe(5000)
  })

  it('setConfigs stores configs', () => {
    useAppStore.getState().setConfigs({ 'dev-1': 'hostname dev1' })
    expect(useAppStore.getState().configs['dev-1']).toBe('hostname dev1')
  })

  it('reset returns to defaults', () => {
    useAppStore.getState().setUseCase('gpu')
    useAppStore.getState().setStep(4)
    useAppStore.getState().setScale('large')
    useAppStore.getState().reset()
    const s = useAppStore.getState()
    expect(s.useCase).toBe('')
    expect(s.step).toBe(1)
    expect(s.scale).toBe('small')
  })
})

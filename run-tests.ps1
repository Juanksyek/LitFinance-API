# Script para ejecutar los tests automatizados de recurrentes
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "TESTS AUTOMATIZADOS DE RECURRENTES" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Paso 1: Autenticación
Write-Host "🔐 Paso 1: Autenticando usuario..." -ForegroundColor Yellow
try {
    $loginBody = @{
        email = "elgalleto12393@gmail.com"
        password = "Admin123"
    } | ConvertTo-Json

    $loginResponse = Invoke-RestMethod `
        -Uri "http://localhost:3000/auth/login" `
        -Method POST `
        -Body $loginBody `
        -ContentType "application/json" `
        -ErrorAction Stop

    $token = $loginResponse.accessToken
    Write-Host "✅ Autenticación exitosa" -ForegroundColor Green
    Write-Host "Token: $($token.Substring(0, 20))..." -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "❌ Error en autenticación: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "⚠️  Asegúrate de que el servidor esté corriendo en http://localhost:3000" -ForegroundColor Yellow
    exit 1
}

# Paso 2: Ejecutar tests automatizados
Write-Host "🧪 Paso 2: Ejecutando tests automatizados..." -ForegroundColor Yellow
Write-Host "Esto puede tomar varios segundos..." -ForegroundColor Gray
Write-Host ""

try {
    $headers = @{
        Authorization = "Bearer $token"
    }

    $testResponse = Invoke-RestMethod `
        -Uri "http://localhost:3000/recurrentes/test/automatizado" `
        -Method POST `
        -Headers $headers `
        -ContentType "application/json" `
        -ErrorAction Stop

    # Mostrar resultados
    Write-Host "==================================" -ForegroundColor Cyan
    Write-Host "RESULTADOS DE LOS TESTS" -ForegroundColor Cyan
    Write-Host "==================================" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "📊 Resumen:" -ForegroundColor Cyan
    Write-Host "   Total de tests: $($testResponse.totalTests)" -ForegroundColor White
    Write-Host "   Tests exitosos: $($testResponse.pasados)" -ForegroundColor Green
    Write-Host "   Tests fallidos: $($testResponse.fallidos)" -ForegroundColor $(if ($testResponse.fallidos -gt 0) { "Red" } else { "Green" })
    Write-Host "   Duración total: $($testResponse.duracionTotal)" -ForegroundColor White
    Write-Host ""

    # Mostrar detalles de cada test
    Write-Host "📋 Detalle de tests:" -ForegroundColor Cyan
    Write-Host ""
    
    foreach ($test in $testResponse.detalles) {
        $statusIcon = if ($test.exitoso) { "✅" } else { "❌" }
        $statusColor = if ($test.exitoso) { "Green" } else { "Red" }
        
        Write-Host "$statusIcon Test $($test.numero): $($test.nombre)" -ForegroundColor $statusColor
        Write-Host "   Duración: $($test.duracion)" -ForegroundColor Gray
        
        if ($test.resultado) {
            Write-Host "   Resultado: $($test.resultado)" -ForegroundColor Gray
        }
        
        if ($test.error) {
            Write-Host "   Error: $($test.error)" -ForegroundColor Red
        }
        
        Write-Host ""
    }

    # Mostrar datos creados durante los tests
    if ($testResponse.datosCreados) {
        Write-Host "📦 Datos creados durante los tests:" -ForegroundColor Cyan
        
        if ($testResponse.datosCreados.recurrenteId) {
            Write-Host "   Recurrente ID: $($testResponse.datosCreados.recurrenteId)" -ForegroundColor Gray
        }
        
        if ($testResponse.datosCreados.cuentaId) {
            Write-Host "   Cuenta ID: $($testResponse.datosCreados.cuentaId)" -ForegroundColor Gray
        }
        
        if ($testResponse.datosCreados.subcuentaId) {
            Write-Host "   Subcuenta ID: $($testResponse.datosCreados.subcuentaId)" -ForegroundColor Gray
        }
        
        Write-Host ""
    }

    # Resultado final
    Write-Host "==================================" -ForegroundColor Cyan
    if ($testResponse.fallidos -eq 0) {
        Write-Host "✅ TODOS LOS TESTS PASARON EXITOSAMENTE" -ForegroundColor Green
    } else {
        Write-Host "⚠️  ALGUNOS TESTS FALLARON" -ForegroundColor Yellow
        Write-Host "   Revisa los detalles arriba para más información" -ForegroundColor Gray
    }
    Write-Host "==================================" -ForegroundColor Cyan

} catch {
    Write-Host "❌ Error ejecutando tests: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Respuesta del servidor: $responseBody" -ForegroundColor Red
    }
    
    exit 1
}
